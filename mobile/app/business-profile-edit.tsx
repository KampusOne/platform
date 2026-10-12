import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ToolButton, ToolField, ToolPage } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { ProfileAvatar } from "@/src/components/profile-avatar";
import { MediaImage } from "@/src/components/media-image";
import { DraftRecovery } from "@/src/components/draft-recovery";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api,ApiError,currentApiUrl } from "@/src/lib/api";
import { validPostId } from "@/src/lib/feed-posts";
import { useAuth } from "@/src/auth/auth-context";
import { cacheScopeForUser } from "@/src/lib/request-policy";
import { getDeviceCacheRevision } from "@/src/lib/device-cache";
import { useOwnedDraftRestore } from "@/src/lib/use-owned-draft-restore";
import { useOwnedDraftSave } from "@/src/lib/use-owned-draft-save";
import { businessFields,businessDraft,businessPayload,sameBusinessFields,restoreBusinessDraft,type BusinessFields,type BusinessProfile } from "@/src/lib/business-draft";
import {pickPhoto,uploadPreparedPhoto,type PreparedPhoto} from "@/src/lib/uploads";

export default function BusinessProfileEdit(){
  const {id}=useLocalSearchParams<{id?:string}>(),{user}=useAuth();
  return <OwnedBusinessProfileEdit key={`${user?cacheScopeForUser(user):'signed-out'}:${id??''}`} id={id} />;
}
function OwnedBusinessProfileEdit({id}:{id:string|undefined}) {
  const {user}=useAuth(),{theme}=useAppearance(),toast=useToast();
  const [profile,setProfile]=useState<BusinessProfile>();
  const [fields,setFields]=useState<BusinessFields>();
  const [editable,setEditable]=useState(false),[error,setError]=useState('');
  const [busy,setBusy]=useState(false),[retry,setRetry]=useState(0),[confirmed,setConfirmed]=useState(false);
  const [conflict,setConflict]=useState<BusinessProfile|null>(null);
  const [photos,setPhotos]=useState<Partial<Record<'avatar'|'cover',PreparedPhoto>>>({});
  const [missingPhotos,setMissingPhotos]=useState<('avatar'|'cover')[]>([]);
  const base=useRef<BusinessFields|undefined>(undefined),revision=useRef<string|undefined>(undefined),latest=useRef<BusinessFields|undefined>(undefined);
  const photoRef=useRef(photos),missingRef=useRef(missingPhotos),mounted=useRef(false),working=useRef(false);
  const key=`business-profile-draft.${user?.id??'anonymous'}.${id??'invalid'}`;
  const restored=useOwnedDraftRestore<unknown>(key,raw=>{
    if(raw===null)return;const saved=restoreBusinessDraft(raw);
    base.current=saved.base;revision.current=saved.revision;latest.current=saved.fields;setFields(saved.fields);
    const recovered={...saved.photos};for(const photo of Object.values(recovered))if(photo)photo.ownerRevision=getDeviceCacheRevision();
    photoRef.current=recovered;missingRef.current=saved.missingPhotos??[];setPhotos(recovered);setMissingPhotos(missingRef.current);
  },Boolean(user&&validPostId(id)));
  const record=()=>latest.current&&base.current?businessDraft(latest.current,base.current,revision.current,photoRef.current,missingRef.current):null;
  const saver=useOwnedDraftSave(key,record(),restored.ready&&Boolean(fields)&&!busy&&!confirmed);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    if(!restored.ready)return;
    let active=true;const controller=new AbortController(),owner=getDeviceCacheRevision();setEditable(false);setError('');
    if(!validPostId(id)){setError('This business profile link is not valid.');return;}
    void api<{profile:BusinessProfile;editable:boolean}>(`/v1/agents/public-profile/${id}`,{cache:'no-store',signal:controller.signal}).then(result=>{
      if(!active||owner!==getDeviceCacheRevision())return;
      setProfile(result.profile);setEditable(result.editable&&Boolean(result.profile.revision));
      if(!latest.current){const values=businessFields(result.profile);base.current=values;revision.current=result.profile.revision;latest.current=values;setFields(values);}
    }).catch(caught=>{if(active&&owner===getDeviceCacheRevision())setError(caught instanceof Error?caught.message:'Your business profile could not load.');});
    return()=>{active=false;controller.abort();};
  },[id,retry,restored.ready]);
  const activeFor=(owner:number)=>mounted.current&&owner===getDeviceCacheRevision();
  function update(field:keyof BusinessFields,value:string){if(!restored.ready||busy||working.current||confirmed||!latest.current)return;const next={...latest.current,[field]:value};latest.current=next;setFields(next);setError('');}
  async function choose(kind:'avatar'|'cover'){
    if(busy||working.current||!editable||!restored.ready||confirmed)return;
    const owner=getDeviceCacheRevision();working.current=true;setBusy(true);
    try{const photo=await pickPhoto(kind);if(!activeFor(owner)||!photo)return;
      photoRef.current={...photoRef.current,[kind]:photo};missingRef.current=missingRef.current.filter(value=>value!==kind);setPhotos(photoRef.current);setMissingPhotos(missingRef.current);await saver.persist(record());
    }catch(caught){if(activeFor(owner))setError(caught instanceof Error?caught.message:'This photo could not open.');}
    finally{if(activeFor(owner)){working.current=false;setBusy(false);}}
  }
  async function finish(owner:number){
    saver.discard();setConfirmed(true);
    try{await saver.persist(null);}catch{if(activeFor(owner))setError('Your business profile is saved online, but its device draft could not be cleared. Retry finishing before leaving.');return;}
    if(!activeFor(owner))return;
    toast('Business profile saved','success');router.canGoBack()?router.back():router.replace({pathname:'/student-service',params:{id:id!}});
  }
  async function save(overwrite=false){
    if(!latest.current||busy||working.current||!editable||!id||!restored.ready||confirmed||(!overwrite&&conflict))return;
    const owner=getDeviceCacheRevision();working.current=true;setBusy(true);setError('');
    try{
      businessPayload(latest.current);
      if(missingRef.current.length)throw new Error('Choose the pending photo again before saving. Your text and uploaded photos are kept.');
      await saver.persist(record());if(!activeFor(owner))return;
      const fresh=await api<{profile:BusinessProfile;editable:boolean}>(`/v1/agents/public-profile/${id}`,{cache:'no-store',timeoutMs:12000});if(!activeFor(owner))return;
      setProfile(fresh.profile);setEditable(fresh.editable&&Boolean(fresh.profile.revision));
      if(!fresh.editable||!fresh.profile.revision)throw new Error('Editing is currently unavailable for this profile. Your draft is kept. Refresh and try again.');
      const online=businessFields(fresh.profile);
      if(overwrite&&conflict?.revision!==fresh.profile.revision){setConflict(fresh.profile);throw new Error('The online profile changed again. Review it before saving your edits.');}
      if(!Object.keys(photoRef.current).length&&sameBusinessFields(latest.current,online)){await finish(owner);return;}
      if(!overwrite&&base.current&&!sameBusinessFields(base.current,online)&&!sameBusinessFields(latest.current,online)){setConflict(fresh.profile);throw new Error('This profile changed online. Your edits are kept. Choose which version to use.');}
      base.current=online;revision.current=fresh.profile.revision;
      await saver.persist(record());if(!activeFor(owner))return;
      for(const kind of ['avatar','cover'] as const){
        const photo=photoRef.current[kind];if(!photo)continue;
        const receipt=await uploadPreparedPhoto('product',photo);if(!activeFor(owner))return;
        latest.current={...latest.current,[kind==='avatar'?'avatarMediaId':'coverMediaId']:receipt.id};
        const nextPhotos={...photoRef.current};delete nextPhotos[kind];photoRef.current=nextPhotos;setPhotos(nextPhotos);setFields(latest.current);
        await saver.persist(record());if(!activeFor(owner))return;
      }
      await api(`/v1/agents/public-profile/${id}`,{method:'PUT',timeoutMs:12000,body:JSON.stringify({...businessPayload(latest.current),expectedRevision:revision.current})});if(!activeFor(owner))return;
      await finish(owner);
    }catch(caught){
      if(!activeFor(owner))return;
      if(caught instanceof ApiError&&[401,403,404].includes(caught.status))setEditable(false);
      if(caught instanceof ApiError&&caught.status===409){
        try{const fresh=await api<{profile:BusinessProfile;editable:boolean}>(`/v1/agents/public-profile/${id}`,{cache:'no-store',timeoutMs:12000});if(!activeFor(owner))return;setConflict(fresh.profile);setEditable(fresh.editable&&Boolean(fresh.profile.revision));}catch{if(!activeFor(owner))return;setEditable(false);}
      }
      if(activeFor(owner))setError(caught instanceof Error?caught.message:'Your business profile could not be saved.');
    }finally{if(activeFor(owner)){working.current=false;setBusy(false);}}
  }
  async function useOnline(){
    if(!conflict||busy||working.current||!restored.ready)return;
    const owner=getDeviceCacheRevision(),next=businessFields(conflict);working.current=true;setBusy(true);
    try{await saver.persist(businessDraft(next,next,conflict.revision,{},[]));if(!activeFor(owner))return;latest.current=next;base.current=next;revision.current=conflict.revision;photoRef.current={};missingRef.current=[];setFields(next);setProfile(conflict);setPhotos({});setMissingPhotos([]);setConflict(null);setError('');}
    catch(caught){if(activeFor(owner))setError(caught instanceof Error?caught.message:'The online copy could not be saved on this device. Your edits are kept.');}
    finally{if(activeFor(owner)){working.current=false;setBusy(false);}}
  }
  const text = {
    fontFamily: theme.font.body,
    color: theme.textMuted,
    fontSize: 13,
    lineHeight: 20,
  };
  return (
    <ToolPage title="Business profile">
      <DraftRecovery loading={restored.loading} error={restored.error} onRetry={restored.retry} />
      {saver.warning?<Text accessibilityRole="alert" style={text}>{saver.warning}</Text>:null}
      {!fields ? (
        error ? (
          <>
            <Text accessibilityRole="alert" style={text}>
              {error}
            </Text>
            <ToolButton
              secondary
              label="Try again"
              onPress={() => setRetry((value) => value + 1)}
            />
          </>
        ) : (
          <ScreenSkeleton />
        )
      ) : (
        <>
          <Text style={{ ...text, marginBottom: 18 }}>
            This is what people see on your {profile?.agentType.toLowerCase()??"business"}{" "}
            profile.
          </Text>
          {!editable ? (
            <Text
              accessibilityRole="alert"
              style={{ ...text, marginBottom: 18 }}
            >
              Editing is currently unavailable. Your draft is kept. Refresh
              the profile to check access again.
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose business cover photo"
            disabled={busy || !editable || !restored.ready || confirmed}
            onPress={() => void choose("cover")}
            style={{ marginBottom: 16 }}
          >
            {photos.cover?.uri || (fields.coverMediaId?`${currentApiUrl()}/v1/media/${fields.coverMediaId}`:profile?.coverImageUrl) ? (
              <MediaImage
                uri={photos.cover?.uri ?? (fields.coverMediaId?`${currentApiUrl()}/v1/media/${fields.coverMediaId}`:profile?.coverImageUrl)!}
                accessibilityLabel="Business cover preview"
                style={{ width: "100%", height: 140, borderRadius: 12 }}
                resizeMode="cover"
              />
            ) : (
              <View
                style={{
                  height: 140,
                  backgroundColor: theme.sand,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name="image-outline"
                  color={theme.deepBrand}
                  size={35}
                />
              </View>
            )}
            <Text style={{ ...text, color: theme.accentText, marginTop: 7 }}>
              Change cover photo
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose business profile photo"
            disabled={busy || !editable || !restored.ready || confirmed}
            onPress={() => void choose("avatar")}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              marginBottom: 24,
            }}
          >
            <ProfileAvatar
              name={fields.displayName}
              imageUrl={photos.avatar?.uri ?? (fields.avatarMediaId?`${currentApiUrl()}/v1/media/${fields.avatarMediaId}`:profile?.profileImageUrl??null)}
              size={70}
            />
            <Text style={{ ...text, color: theme.accentText }}>
              Change business photo
            </Text>
          </Pressable>
          <ToolField
            label="Business name"
            value={fields.displayName}
            onChangeText={(value) => update("displayName", value)}
            maxLength={120}
            editable={restored.ready && !busy && !confirmed}
          />
          <ToolField
            label="Business bio"
            value={fields.biography}
            onChangeText={(value) => update("biography", value)}
            multiline
            maxLength={2000}
            editable={restored.ready && !busy && !confirmed}
            placeholder="Tell people what you offer"
          />
          <ToolField
            label="Categories"
            value={fields.categories}
            onChangeText={value=>update("categories",value)}
            maxLength={408}
            editable={restored.ready && !busy && !confirmed}
            placeholder="Restaurant, Food, Drinks"
          />
          <Text style={{ ...text, marginTop: -10, marginBottom: 20 }}>
            Separate up to eight categories with commas.
          </Text>
          <ToolField
            label="Public phone number (optional)"
            value={fields.phone ?? ""}
            onChangeText={(value) => update("phone", value)}
            keyboardType="phone-pad"
            maxLength={20}
            editable={restored.ready && !busy && !confirmed}
            placeholder="08012345678"
          />
          <ToolField
            label="Public WhatsApp number (optional)"
            value={fields.whatsapp ?? ""}
            onChangeText={(value) => update("whatsapp", value)}
            keyboardType="phone-pad"
            maxLength={20}
            editable={restored.ready && !busy && !confirmed}
            placeholder="08012345678"
          />
          <ToolField
            label="Public location (optional)"
            value={fields.pickupLocation ?? ""}
            onChangeText={(value) => update("pickupLocation", value)}
            maxLength={500}
            multiline
            editable={restored.ready && !busy && !confirmed}
            placeholder="Where customers can find you"
          />
          <Text style={{ ...text, marginBottom: 16 }}>
            These contact details are public. Your verification documents stay
            private.
          </Text>
          {missingPhotos.length?<Text accessibilityRole="alert" style={text}>Choose the pending {missingPhotos.join(" and ")} photo again. Browser photo previews are kept while the tab stays open.</Text>:null}
          {conflict?<View style={{gap:10,marginBottom:16}}><Text style={text}>Online profile: {conflict.displayName}. Your edits are kept below.</Text><ToolButton secondary label="Use online profile" disabled={busy} onPress={()=>void useOnline()} /><ToolButton label="Save my edits" disabled={busy||!editable} onPress={()=>void save(true)} /></View>:null}
          {error ? (
            <Text
              accessibilityRole="alert"
              style={{ ...text, color: theme.error, marginBottom: 12 }}
            >
              {error}
            </Text>
          ) : null}
          {!editable?<ToolButton secondary label="Refresh profile" disabled={busy} onPress={()=>setRetry(value=>value+1)} />:null}
          {confirmed?<ToolButton label="Retry finishing" disabled={busy} onPress={()=>{if(working.current)return;const owner=getDeviceCacheRevision();working.current=true;setBusy(true);void finish(owner).finally(()=>{if(activeFor(owner)){working.current=false;setBusy(false);}});}} />:<ToolButton
            label={busy ? "Saving…" : "Save business profile"}
            disabled={busy || !editable || !restored.ready || Boolean(conflict)}
            onPress={() => void save()}
          />}
        </>
      )}
    </ToolPage>
  );
}
