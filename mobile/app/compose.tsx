import { MediaPreview } from "@/src/components/media-preview";
import { InlineLoading } from "@/src/components/skeleton";
import { useCallback, useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import { Image, Text, View, Pressable, TextInput, ScrollView, KeyboardAvoidingView, Platform, StyleSheet, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ProfileAvatar } from "@/src/components/profile-avatar";
import { useAuth } from "@/src/auth/auth-context";

import { QuotedPostPreview } from "@/src/components/quoted-post";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { validPostId } from "@/src/lib/feed-posts";
import type { SocialFeedPost } from "@/src/lib/feed-social";
import { editPostMedia, pickPostMedia, uploadPostMedia, verifyPhoto, type PostMedia, type UploadedFile, type PhotoSource } from "@/src/lib/uploads";

export default function Compose() {
  const { theme } = useAppearance();
  const toast = useToast();
  const {user,profile}=useAuth();
  const [discard,setDiscard]=useState(false);
  const owner=useRef(user?.id);owner.current=user?.id;
  const boundOwner=useRef(user?.id);
  const { quote } = useLocalSearchParams<{ quote?: string | string[] }>();
  const isQuote = quote !== undefined;
  const quoteId = validPostId(quote) ? quote : null;
  const [original, setOriginal] = useState<SocialFeedPost | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(isQuote);
  const [quoteError, setQuoteError] = useState("");
  const [body, setBody] = useState("");
  const [photo, setPhoto] = useState<UploadedFile | null>(null);
  const [draftPhoto, setDraftPhoto] = useState<PostMedia | null>(null);
  const [photoReady, setPhotoReady] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const lock = useRef(false);
  const requestId = useRef(randomUUID());
  const alive = useRef(true);
  const quoteVersion = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; quoteVersion.current++; }; }, []);

  const loadQuote = useCallback(async () => {
    const version = ++quoteVersion.current;
    setOriginal(null);
    if (!isQuote) { setQuoteLoading(false); return; }
    if (!quoteId) { setQuoteLoading(false); setQuoteError("This original post link is invalid."); return; }
    setQuoteLoading(true); setQuoteError("");
    try {
      const result = await api<{ post: SocialFeedPost }>(`/v1/student/feed/${quoteId}`);
      if (alive.current && version === quoteVersion.current) {
        if (!result.post.social_enabled) setQuoteError("Quote posts are being connected. Please try again shortly.");
        else setOriginal(result.post);
      }
    } catch (error) {
      if (alive.current && version === quoteVersion.current) setQuoteError(error instanceof Error ? error.message : "The original post could not be loaded.");
    } finally { if (alive.current && version === quoteVersion.current) setQuoteLoading(false); }
  }, [isQuote, quoteId]);
  useEffect(() => { requestId.current = randomUUID(); void loadQuote(); }, [loadQuote]);

  async function transfer(local: PostMedia, existing: UploadedFile | null = null) {
    setPhotoError(""); setPhotoReady(false);
    // Retain a successful upload on a failed delivery check: Retry checks its
    // existing URL instead of uploading duplicate files to the bucket.
    const saved = existing ?? await uploadPostMedia(local);
    if (!alive.current) return;
    setPhoto(saved);
    if(!local.type.startsWith("video/")) await verifyPhoto(saved.url);
    if (alive.current) setPhotoReady(true);
  }
  async function attach(retry = false, source:PhotoSource = "library") {
    if (lock.current) return;
    lock.current = true; setBusy(true); setUploading(true);
    try {
      const local = retry ? draftPhoto : await pickPostMedia(source);
      if (!local || !alive.current) return;
      if (!retry) {
        setDraftPhoto(local); setPhoto(null); setPhotoReady(false); setPreviewError(false);
        requestId.current = randomUUID();
      }
      await transfer(local, retry ? photo : null);
    } catch (error) {
      if (alive.current) {
        const message = error instanceof Error ? error.message : "Upload failed. Your media is still here; retry, edit, or replace it.";
        setPhotoError(message); toast(message, "error");
      }
    } finally {
      lock.current = false;
      if (alive.current) { setBusy(false); setUploading(false); }
    }
  }
  async function editCurrentMedia() {
    if (lock.current || !draftPhoto) return;
    lock.current = true;
    setBusy(true);
    setUploading(true);
    try {
      const edited = await editPostMedia(draftPhoto);
      if (!edited || !alive.current) return;
      setDraftPhoto(edited);
      setPhoto(null);
      setPhotoReady(false);
      setPhotoError("");
      setPreviewError(false);
      requestId.current = randomUUID();
      await transfer(edited);
    } catch (error) {
      if (alive.current) {
        const message =
          error instanceof Error
            ? error.message
            : "The media could not be edited. Your current draft is still here.";
        setPhotoError(message);
        toast(message, "error");
      }
    } finally {
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        setUploading(false);
      }
    }
  }
  const canPost = owner.current===boundOwner.current && !busy && (body.trim().length > 0 || Boolean(photoReady)) && (!draftPhoto || (photoReady && !previewError)) && (!isQuote || Boolean(original && !quoteLoading));
  async function publish() {
    if (lock.current || !canPost) return;
    lock.current = true; setBusy(true);
    try {
      await api("/v1/student/feed", { method: "POST", body: JSON.stringify({ body, mediaId: photo?.id, requestId: requestId.current, ...(isQuote ? { quotedPostId: quoteId } : {}) }) });
      if (alive.current) { toast(isQuote ? "Quote posted" : "Posted", "success"); router.replace("/(tabs)/feed"); }
    } catch (error) {
      if (alive.current) toast(error instanceof Error ? error.message : "Could not post. Your draft is still here.", "error");
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function close(){if(busy)return;if(body.trim()||draftPhoto)setDiscard(true);else router.canGoBack()?router.back():router.replace("/(tabs)/feed");}
  const text={fontFamily:theme.font.body,color:theme.text,fontSize:14,lineHeight:20};
  const remove=()=>{setPhoto(null);setDraftPhoto(null);setPhotoReady(false);setPhotoError("");setPreviewError(false);requestId.current=randomUUID();};
  if(owner.current!==boundOwner.current)return <SafeAreaView style={{flex:1,backgroundColor:theme.canvas}}><Text style={{...text,padding:24}}>Your account changed. Reopen the composer to start a new post.</Text><Pressable onPress={()=>router.replace("/(tabs)/feed")} accessibilityRole="button" style={{padding:24}}><Text style={text}>Back to feed</Text></Pressable></SafeAreaView>;
  return <SafeAreaView edges={["top","bottom"]} style={{flex:1,backgroundColor:theme.canvas}}>
    <KeyboardAvoidingView behavior={Platform.OS==="ios"?"padding":undefined} style={{flex:1,width:"100%",maxWidth:660,alignSelf:"center"}}>
      <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingHorizontal:15,paddingVertical:8,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.border}}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close post composer" disabled={busy} onPress={close} style={{padding:10}}><Ionicons name="close" size={26} color={theme.text}/></Pressable>
        <Text style={{...text,fontFamily:theme.font.semibold}}>{isQuote?"Quote post":"New post"}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Publish post" accessibilityState={{disabled:!canPost,busy:busy&&!uploading}} disabled={!canPost} onPress={()=>void publish()} style={{paddingHorizontal:20,paddingVertical:10,borderRadius:22,backgroundColor:theme.deepBrand,opacity:canPost?1:0.45}}><Text style={{...text,fontFamily:theme.font.semibold,color:"#FFFFFF"}}>{busy&&!uploading?"Posting…":"Post"}</Text></Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{flexGrow:1,padding:20}}>
        <View style={{flexDirection:"row",alignItems:"center",gap:10,marginBottom:18}}><ProfileAvatar name={profile?.display_name??"You"} imageUrl={profile?.profile_image_url} size={42}/><View><Text style={{...text,fontFamily:theme.font.semibold}}>{profile?.display_name??"You"}</Text><Text style={{...text,fontSize:11,color:theme.textMuted}}>{isQuote&&original?.visibility!=="PUBLIC"?"Your campus":"KampusOne community"}</Text></View></View>
        <TextInput accessibilityLabel={isQuote?"Your thoughts on this post":"Post text"} placeholder={isQuote?"Add your thoughts…":"What’s happening on campus?"} placeholderTextColor={theme.textMuted} value={body} editable={!busy} onChangeText={value=>{setBody(value);requestId.current=randomUUID();}} multiline maxLength={5000} style={{fontFamily:theme.font.body,color:theme.text,fontSize:18,lineHeight:28,minHeight:160,textAlignVertical:"top",padding:0,marginBottom:18}}/>
        {draftPhoto?<View style={{position:"relative",marginBottom:15}}>{draftPhoto.type.startsWith("video/")?<MediaPreview url={draftPhoto.uri} video label="Selected video"/>:<Image accessibilityLabel="Selected post photo" source={{uri:draftPhoto.uri}} resizeMode="contain" onLoad={()=>setPreviewError(false)} onError={()=>setPreviewError(true)} style={{width:"100%",height:270,borderRadius:15,backgroundColor:theme.surfaceMuted}}/>}<Pressable accessibilityRole="button" accessibilityLabel="Remove media" disabled={busy} onPress={remove} style={{position:"absolute",top:8,right:8,padding:8,borderRadius:22,backgroundColor:"rgba(0,0,0,0.7)"}}><Ionicons name="close" size={20} color="#FFFFFF"/></Pressable><Pressable accessibilityRole="button" accessibilityLabel={draftPhoto.type.startsWith("video/")?"Edit video trim":"Edit photo crop"} disabled={busy} onPress={()=>void editCurrentMedia()} style={{position:"absolute",top:8,left:8,paddingHorizontal:12,paddingVertical:8,borderRadius:18,backgroundColor:"rgba(0,0,0,0.72)"}}><Text style={{...text,color:"#FFFFFF",fontFamily:theme.font.semibold,fontSize:12}}>Edit</Text></Pressable>{uploading?<View style={{flexDirection:"row",alignItems:"center",gap:8,marginTop:8}}><InlineLoading/><Text style={{...text,color:theme.textMuted,fontSize:12}}>Preparing media…</Text></View>:null}</View>:null}
        {previewError?<Text accessibilityRole="alert" style={{...text,color:theme.error,marginBottom:10}}>The media preview could not load. Replace or remove it before posting.</Text>:null}
        {photoError?<View style={{marginBottom:15,gap:8}}><Text accessibilityRole="alert" style={{...text,color:theme.error}}>{photoError}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={()=>void attach(true)} style={{paddingVertical:10}}><Text style={{...text,color:theme.brand,fontFamily:theme.font.semibold}}>Retry upload</Text></Pressable></View>:null}
        {isQuote&&quoteLoading?<InlineLoading/>:null}{original?<QuotedPostPreview post={original}/>:null}
        {quoteError?<View style={{gap:10}}><Text accessibilityRole="alert" style={{...text,color:theme.error}}>{quoteError}</Text>{quoteId?<Pressable accessibilityRole="button" onPress={()=>void loadQuote()} disabled={busy} style={{paddingVertical:10}}><Text style={{...text,color:theme.brand}}>Retry original post</Text></Pressable>:null}</View>:null}
      </ScrollView>
      <View style={{flexDirection:"row",alignItems:"center",paddingHorizontal:16,paddingVertical:10,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:theme.border}}><Pressable accessibilityRole="button" accessibilityLabel={draftPhoto?"Replace image or video":"Attach image or video"} disabled={busy} onPress={()=>void attach()} style={{padding:10}}><Ionicons name="image-outline" size={25} color={theme.brand}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Take a photo" disabled={busy} onPress={()=>void attach(false,"camera")} style={{padding:10}}><Ionicons name="camera-outline" size={25} color={theme.brand}/></Pressable><View style={{flex:1}}/><Text accessibilityLabel={`${body.length} of 5000 characters`} style={{...text,fontSize:12,color:theme.textMuted}}>{body.length}/5000</Text></View>
      <Modal visible={discard} transparent animationType="fade" onRequestClose={()=>setDiscard(false)}><View style={{flex:1,justifyContent:"center",padding:30,backgroundColor:"rgba(0,0,0,0.4)"}}><View style={{padding:24,gap:18,borderRadius:18,backgroundColor:theme.surface}}><Text style={{...text,fontFamily:theme.font.semibold,fontSize:19}}>Discard this draft?</Text><Text style={text}>Your text and selected media will be removed from this composer.</Text><Pressable accessibilityRole="button" onPress={()=>{setDiscard(false);router.canGoBack()?router.back():router.replace("/(tabs)/feed");}} style={{padding:10}}><Text style={{...text,color:theme.error}}>Discard</Text></Pressable><Pressable accessibilityRole="button" onPress={()=>setDiscard(false)} style={{padding:10}}><Text style={text}>Keep editing</Text></Pressable></View></View></Modal>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
