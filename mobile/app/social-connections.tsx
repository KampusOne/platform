import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { api } from "@/src/lib/api";
import { useAppearance } from "@/src/lib/appearance";
import { validPostId } from "@/src/lib/feed-posts";
import { ProfileAvatar } from "@/src/components/profile-avatar";
import { VerifiedBadge } from "@/src/components/verified-badge";
import { ListSkeleton } from "@/src/components/skeleton";

type ConnectionPerson={
  user_id:string;
  display_name:string;
  username:string|null;
  profile_image_url:string|null;
  current_level:number|string|null;
  university_name:string|null;
  department_name:string|null;
  verified:boolean;
};
type ConnectionsPage={people:ConnectionPerson[];nextCursor?:string|null};

export default function SocialConnectionsScreen(){
  const {id,kind}=useLocalSearchParams<{id?:string;kind?:string}>();
  const {theme}=useAppearance();
  const target=validPostId(id)?id:"";
  const mode=kind==="following"?"following":"followers";
  const scope=`${target}:${mode}`;
  const [people,setPeople]=useState<ConnectionPerson[]>([]);
  const [cursor,setCursor]=useState<string|null>(null);
  const [loadedScope,setLoadedScope]=useState("");
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [more,setMore]=useState(false);
  const [error,setError]=useState("");
  const version=useRef(0);
  const mounted=useRef(true);
  const moreLock=useRef(false);

  useEffect(()=>()=>{mounted.current=false;version.current++;},[]);
  useEffect(()=>{
    setPeople([]);
    setCursor(null);
    setLoadedScope("");
    setError("");
    setLoading(true);
    moreLock.current=false;
  },[scope]);

  const endpoint=useCallback((nextCursor?:string|null)=>{
    const base=`/v1/people/${target}/${mode}`;
    return nextCursor?`${base}?cursor=${encodeURIComponent(nextCursor)}`:base;
  },[mode,target]);

  const load=useCallback(async(refresh=false)=>{
    const request=++version.current;
    setError("");
    if(refresh)setRefreshing(true);else setLoading(true);
    try{
      if(!target)throw new Error("This student link is not valid.");
      const page=await api<ConnectionsPage>(endpoint());
      if(!mounted.current||request!==version.current)return;
      setPeople(page.people);
      setCursor(page.nextCursor??null);
      setLoadedScope(scope);
    }catch(caught){
      if(mounted.current&&request===version.current)setError(caught instanceof Error?caught.message:"This list could not load.");
    }finally{
      if(mounted.current&&request===version.current){setLoading(false);setRefreshing(false);}
    }
  },[endpoint,scope,target]);

  useFocusEffect(useCallback(()=>{
    mounted.current=true;
    void load(loadedScope===scope);
    return()=>{version.current++;};
  },[load,loadedScope,scope]));

  async function loadMore(){
    if(!cursor||moreLock.current||loading||more)return;
    const request=version.current;
    moreLock.current=true;
    setMore(true);
    try{
      const page=await api<ConnectionsPage>(endpoint(cursor));
      if(mounted.current&&request===version.current){
        setPeople(current=>[...current,...page.people.filter(person=>!current.some(item=>item.user_id===person.user_id))]);
        setCursor(page.nextCursor??null);
      }
    }catch(caught){
      if(mounted.current&&request===version.current)setError(caught instanceof Error?caught.message:"More people could not load.");
    }finally{
      moreLock.current=false;
      if(mounted.current&&request===version.current)setMore(false);
    }
  }

  const label={fontFamily:theme.font.body,color:theme.text,fontSize:14};
  const title=mode==="followers"?"Followers":"Following";
  const empty=mode==="followers"?"No followers yet.":"Not following anyone yet.";

  return <SafeAreaView edges={["top"]} style={{flex:1,backgroundColor:theme.canvas}}>
    <View style={{flex:1,width:"100%",maxWidth:660,alignSelf:"center"}}>
      <View style={{flexDirection:"row",alignItems:"center",gap:12,paddingHorizontal:12,paddingVertical:8,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.border}}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={()=>router.canGoBack()?router.back():router.replace("/(tabs)/profile")} style={{padding:10}}>
          <Ionicons name="arrow-back" size={23} color={theme.text}/>
        </Pressable>
        <Text style={{...label,fontFamily:theme.font.display,fontSize:21}}>{title}</Text>
      </View>
      {loading&&loadedScope!==scope?<View style={{paddingHorizontal:18}}><ListSkeleton count={6}/></View>:
      error&&people.length===0?<View style={{padding:24,gap:14}}>
        <Text accessibilityRole="alert" style={{...label,color:theme.textMuted,lineHeight:21}}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={()=>void load()} style={{alignSelf:"flex-start",paddingHorizontal:16,paddingVertical:10,borderRadius:10,backgroundColor:theme.deepBrand}}>
          <Text style={{...label,color:"#FFFFFF",fontFamily:theme.font.semibold}}>Retry</Text>
        </Pressable>
      </View>:
      <FlatList
        data={people}
        keyExtractor={item=>item.user_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>void load(true)} tintColor={theme.brand}/>}
        onEndReached={()=>void loadMore()}
        onEndReachedThreshold={0.45}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{paddingHorizontal:18,paddingBottom:36,flexGrow:people.length?0:1}}
        renderItem={({item})=>{
          const meta=[item.department_name,item.current_level?`${item.current_level} level`:null,item.university_name].filter(Boolean).join(" · ");
          return <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.display_name}'s profile`}
            onPress={()=>router.push({pathname:"/student-profile",params:{id:item.user_id}})}
            style={({pressed})=>({minHeight:72,flexDirection:"row",alignItems:"center",gap:12,paddingVertical:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.border,opacity:pressed?0.65:1})}
          >
            <ProfileAvatar name={item.display_name} imageUrl={item.profile_image_url} size={48}/>
            <View style={{flex:1,minWidth:0}}>
              <View style={{flexDirection:"row",alignItems:"center",gap:5}}>
                <Text numberOfLines={1} style={{...label,fontFamily:theme.font.semibold,fontSize:15,flexShrink:1}}>{item.display_name}</Text>
                {item.verified?<VerifiedBadge size={14}/>:null}
              </View>
              {item.username?<Text numberOfLines={1} style={{...label,color:theme.textMuted,fontSize:12,marginTop:2}}>@{item.username}</Text>:null}
              {meta?<Text numberOfLines={1} style={{...label,color:theme.textMuted,fontSize:11,marginTop:4}}>{meta}</Text>:null}
            </View>
            <Ionicons name="chevron-forward" size={17} color={theme.textMuted}/>
          </Pressable>;
        }}
        ListEmptyComponent={<View style={{flex:1,alignItems:"center",justifyContent:"center",padding:32}}><Text style={{...label,color:theme.textMuted,textAlign:"center"}}>{empty}</Text></View>}
        ListFooterComponent={more?<ListSkeleton count={2}/>:error&&people.length?<Text accessibilityRole="alert" style={{...label,color:theme.textMuted,paddingVertical:14}}>{error}</Text>:null}
      />}
    </View>
  </SafeAreaView>;
}
