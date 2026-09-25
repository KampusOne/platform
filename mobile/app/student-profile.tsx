import {useReducedMotionPreference} from "@/src/components/visual-system";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";
import { api, clearApiCache } from "@/src/lib/api";
import { validPostId, sharePostLink, postUrl, type FeedPostData } from "@/src/lib/feed-posts";
import { safeCount, type SocialFeedPost } from "@/src/lib/feed-social";
import { ProfileAvatar } from "@/src/components/profile-avatar";
import { VerifiedBadge } from "@/src/components/verified-badge";
import { MediaImage } from "@/src/components/media-image";
import { FeedPost } from "@/src/components/feed-post";
import { FeedSkeleton, ProfileSkeleton } from "@/src/components/skeleton";
import { useToast } from "@/src/components/toast";

type Person={cgpa?:number|string|null;user_id:string;display_name:string;username:string|null;biography:string|null;profile_image_url:string|null;cover_image_url:string|null;university_name:string|null;department_name:string|null;current_level:number|null;verified:boolean;can_view_reposts?:boolean;follower_count:number;following_count:number;post_count:number;followed:boolean;has_events:boolean};
type PersonResponse={profile:Person;roles:{id:string;agent_type:"VENDOR"|"TUTOR"|"RIDER"}[];isOwner:boolean};
type Page={posts:SocialFeedPost[];nextCursor?:string|null};
export default function StudentProfile(){
  const {id}=useLocalSearchParams<{id?:string}>();const {user}=useAuth();const {theme}=useAppearance();const toast=useToast();
  const reducedMotion=useReducedMotionPreference(),followScale=useRef(new Animated.Value(1)).current;
  const target=validPostId(id)?id:"";const scope=`${user?.id}:${target}`;const current=useRef(scope);current.current=scope;
  const [data,setData]=useState<PersonResponse>();const [loadedScope,setLoadedScope]=useState("");const [posts,setPosts]=useState<SocialFeedPost[]>([]);
  const [cursor,setCursor]=useState<string|null>(null);const [tab,setTab]=useState<"posts"|"reposts"|"events">("posts");
  const [loading,setLoading]=useState(true);const [refreshing,setRefreshing]=useState(false);const [more,setMore]=useState(false);const [error,setError]=useState("");const [following,setFollowing]=useState(false);const [manualLink,setManualLink]=useState("");
  const mounted=useRef(true),version=useRef(0),followLock=useRef(false),moreLock=useRef(false);
  useEffect(()=>()=>{mounted.current=false;version.current++;},[]);
  const feedPath=useCallback((nextCursor?:string|null)=>{
    const query=[tab==="reposts"?`repostedBy=${target}`:`author=${target}`];
    if(tab==="events")query.push("category=EVENT");
    if(nextCursor)query.push(`cursor=${encodeURIComponent(nextCursor)}`);
    return `/v1/student/feed?${query.join("&")}`;
  },[tab,target]);
  const load=useCallback(async(refresh=false)=>{
    const request=++version.current;setError("");if(refresh)setRefreshing(true);else setLoading(true);
    try{if(!target)throw new Error("This student link is not valid.");const [person,page]=await Promise.all([api<PersonResponse>(`/v1/people/${target}`),api<Page>(feedPath())]);
      if(!mounted.current||current.current!==scope||request!==version.current)return;setData(person);setPosts(page.posts);setCursor(page.nextCursor??null);setLoadedScope(scope);
    }catch(e){if(mounted.current&&current.current===scope&&request===version.current)setError(e instanceof Error?e.message:"This profile could not load.");}
    finally{if(mounted.current&&current.current===scope&&request===version.current){setLoading(false);setRefreshing(false);}}
  },[scope,target,feedPath]);
  useFocusEffect(useCallback(()=>{mounted.current=true;void load();return()=>{version.current++;};},[load]));
  useEffect(()=>{setData(undefined);setPosts([]);setCursor(null);setLoadedScope("");setManualLink("");setFollowing(false);followLock.current=false;},[scope]);
  const person=loadedScope===scope?data?.profile:undefined;
  async function toggleFollow(){if(!person||data?.isOwner||followLock.current)return;followLock.current=true;setFollowing(true);try{const result=await api<{followed:boolean;follower_count:number}>(`/v1/people/${target}/follow`,{method:"PUT",body:JSON.stringify({follow:!person.followed})});if(mounted.current&&current.current===scope){setData(old=>old?{...old,profile:{...old.profile,...result}}:old);if(!reducedMotion){followScale.setValue(0.94);Animated.spring(followScale,{toValue:1,useNativeDriver:true,friction:6}).start();}}}catch(e){if(current.current===scope)toast(e instanceof Error?e.message:"Follow could not be updated.","error");}finally{followLock.current=false;if(mounted.current&&current.current===scope)setFollowing(false);}}
  async function next(){if(!cursor||moreLock.current||loading)return;const request=version.current;moreLock.current=true;setMore(true);try{const page=await api<Page>(feedPath(cursor));if(mounted.current&&current.current===scope&&request===version.current){setPosts(old=>[...old,...page.posts.filter(p=>!old.some(o=>o.id===p.id))]);setCursor(page.nextCursor??null);}}catch(e){if(current.current===scope)toast(e instanceof Error?e.message:"Could not load more posts.","error");}finally{moreLock.current=false;if(mounted.current)setMore(false);}}
  async function bookmark(post:FeedPostData){try{await api(`/v1/student/feed/${post.id}/bookmark`,{method:post.bookmarked?"DELETE":"PUT"});if(current.current===scope)setPosts(rows=>rows.map(p=>p.id===post.id?{...p,bookmarked:!post.bookmarked}:p));}catch(e){toast(e instanceof Error?e.message:"Could not update saved posts.","error");}}
  async function share(post:FeedPostData){try{const result=await sharePostLink(post);if(current.current!==scope)return;if(result==="manual")setManualLink(postUrl(post.id));else if(result==="copied")toast("Post link copied","success");}catch{toast("The post link could not be shared.","error");}}
  const label={fontFamily:theme.font.body,color:theme.text,fontSize:14};
  const button=(title:string,onPress:()=>void,disabled=false,selected=false)=><Pressable accessibilityRole="button" accessibilityState={{disabled,selected}} disabled={disabled} onPress={onPress} style={{paddingHorizontal:19,paddingVertical:11,borderRadius:22,backgroundColor:selected?"transparent":theme.deepBrand,borderWidth:1,borderColor:theme.deepBrand,opacity:disabled?0.5:1}}><Text style={{fontFamily:theme.font.semibold,color:selected?theme.deepBrand:"#FFFFFF",fontSize:13}}>{title}</Text></Pressable>;
  return <SafeAreaView edges={["top"]} style={{flex:1,backgroundColor:theme.canvas}}><View style={{flex:1,width:"100%",maxWidth:660,alignSelf:"center"}}>
    <View style={{flexDirection:"row",alignItems:"center",gap:12,paddingHorizontal:12,paddingVertical:6,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.border}}><Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={()=>router.canGoBack()?router.back():router.replace("/(tabs)/feed")} style={{padding:10}}><Ionicons name="arrow-back" size={23} color={theme.text}/></Pressable><View><Text numberOfLines={1} style={{...label,fontFamily:theme.font.semibold,fontSize:17}}>{person?.display_name??"Student profile"}</Text>{person?<Text style={{...label,color:theme.textMuted,fontSize:11}}>{safeCount(person.post_count)} posts</Text>:null}</View></View>
    {!person&&loading?<ProfileSkeleton/>:null}
    {!person&&!loading?<View style={{padding:24,gap:15}}><Text accessibilityRole="alert" style={label}>{error||"This profile is not available."}</Text>{button("Retry",()=>void load())}</View>:null}
    {person?<FlatList data={loading&&!refreshing?[]:posts} keyExtractor={post=>post.id} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{clearApiCache();void load(true);}}/>}
      ListHeaderComponent={<View>
        {person.cover_image_url?<MediaImage uri={person.cover_image_url} accessibilityLabel={`${person.display_name}'s cover photo`} resizeMode="cover" style={{width:"100%",height:170}}/>:<View style={{height:150,backgroundColor:theme.sand}}/>}
        <View style={{paddingHorizontal:18,paddingBottom:16}}>
          <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"flex-end",marginTop:-38}}><View style={{padding:4,borderRadius:50,backgroundColor:theme.canvas}}><ProfileAvatar name={person.display_name} imageUrl={person.profile_image_url} size={80}/></View><View style={{paddingBottom:4}}>{data?.isOwner?button("Edit profile",()=>router.push("/account-edit")):<Animated.View style={{transform:[{scale:followScale}]}}>{button(person.followed?"Following ✓":"Follow",()=>void toggleFollow(),following,person.followed)}</Animated.View>}</View></View>
          <View style={{flexDirection:"row",alignItems:"center",gap:5,marginTop:12}}><Text style={{...label,fontFamily:theme.font.display,fontSize:23}}>{person.display_name}</Text>{person.verified?<VerifiedBadge size={16}/>:null}</View>
          {person.username?<Text style={{...label,color:theme.textMuted,marginTop:3}}>@{person.username}</Text>:null}
          {person.biography?<Text selectable style={{...label,lineHeight:21,marginTop:13}}>{person.biography}</Text>:null}
          <Text style={{...label,color:theme.textMuted,fontSize:12,lineHeight:19,marginTop:10}}>{[person.university_name,person.department_name,person.current_level?`${person.current_level} level`:null].filter(Boolean).join(" · ")}</Text>
          <View style={{flexDirection:"row",gap:20,marginTop:13,flexWrap:"wrap"}}><Text style={label}><Text style={{fontFamily:theme.font.semibold}}>{safeCount(person.follower_count)}</Text> followers</Text><Text style={label}><Text style={{fontFamily:theme.font.semibold}}>{safeCount(person.following_count)}</Text> following</Text><Text style={label}><Text style={{fontFamily:theme.font.semibold}}>{safeCount(person.post_count)}</Text> posts</Text></View>
          {person.cgpa != null ? <Text style={{...label,marginTop:12}}>CGPA <Text style={{fontFamily:theme.font.semibold}}>{Number(person.cgpa).toFixed(2)}</Text></Text> : null}
          {data?.roles.length?<View style={{flexDirection:"row",flexWrap:"wrap",gap:8,marginTop:16}}>{data.roles.map(role=><Pressable key={role.id} accessibilityRole="button" onPress={()=>router.push({pathname:"/student-service",params:{id:role.id}})} style={{flexDirection:"row",alignItems:"center",gap:5,borderRadius:9,paddingHorizontal:11,paddingVertical:8,backgroundColor:theme.surfaceMuted}}><Ionicons name={role.agent_type==="VENDOR"?"storefront-outline":role.agent_type==="TUTOR"?"school-outline":"bicycle-outline"} size={15} color={theme.brand}/><Text style={{...label,fontSize:12}}>{role.agent_type==="VENDOR"?"Vendor":role.agent_type==="TUTOR"?"Tutor":"Rider"}</Text><Ionicons name="chevron-forward" size={12} color={theme.textMuted}/></Pressable>)}</View>:null}
        </View>
        <View style={{flexDirection:"row",borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.border}}>{(["posts",...((data?.isOwner||person.can_view_reposts!==false)?["reposts"]:[]),...(person.has_events?["events"]:[])] as ("posts"|"reposts"|"events")[]).map(value=><Pressable accessibilityRole="tab" accessibilityState={{selected:tab===value}} key={value} onPress={()=>setTab(value)} style={{flex:1,padding:15,alignItems:"center",borderBottomWidth:2,borderBottomColor:tab===value?theme.brand:"transparent"}}><Text style={{...label,fontFamily:theme.font.semibold}}>{value==="posts"?"Posts":value==="reposts"?"Reposts":"Events"}</Text></Pressable>)}</View>
        {manualLink?<Text selectable style={{...label,padding:16}}>{manualLink}</Text>:null}{error?<Text accessibilityRole="alert" style={{...label,padding:16,color:theme.error}}>{error}</Text>:null}
      </View>}
      renderItem={({item})=><View style={{paddingHorizontal:16}}><FeedPost post={item} onBookmark={p=>void bookmark(p)} onShare={p=>void share(p)} onFeedback={message=>toast(message)} onChanged={post=>setPosts(rows=>rows.map(p=>p.id===post.id?post:p))} onDeleted={postId=>{setPosts(rows=>rows.filter(p=>p.id!==postId));setData(old=>old?{...old,profile:{...old.profile,post_count:Math.max(0,old.profile.post_count-1)}}:old);}}/></View>}
      ListEmptyComponent={loading?<View style={{padding:16}}><FeedSkeleton count={2}/></View>:<View style={{padding:30}}><Text style={{...label,color:theme.textMuted,textAlign:"center"}}>{tab==="events"?"No published events yet.":tab==="reposts"?"No reposts yet.":"No posts yet."}</Text></View>}
      ListFooterComponent={<View style={{padding:18,paddingBottom:40}}>{more?<FeedSkeleton count={1}/>:cursor?button("Load more",()=>void next()):null}</View>}/>:null}
  </View></SafeAreaView>;
}
