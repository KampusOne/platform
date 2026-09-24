import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { validPostId } from "@/src/lib/feed-posts";
import { ProfileAvatar } from "@/src/components/profile-avatar";
import { MediaImage } from "@/src/components/media-image";
import { ScreenSkeleton } from "@/src/components/skeleton";

type Product={id:string;name:string;description:string;price_kobo:number;stock_quantity:number;image_url:string|null};
type Tutorial={id:string;title:string;description:string;course_code:string;price_kobo:number};
type Result={service:{id:string;agent_type:string;user_id:string;display_name:string;biography:string|null;owner_name:string;profile_image_url:string|null};products:Product[];tutorials:Tutorial[];selectedProductId?:string};
export default function StudentService(){
  const {id,product}=useLocalSearchParams<{id?:string;product?:string}>();const {user}=useAuth();const {theme}=useAppearance();
  const [data,setData]=useState<Result>();const [error,setError]=useState("");const [loading,setLoading]=useState(true);
  const scope=`${user?.id}:${id}:${product}`;const current=useRef(scope);current.current=scope;const generation=useRef(0);
  const load=useCallback(async()=>{const n=++generation.current;setLoading(true);setError("");setData(undefined);try{const target=product??id;if(!validPostId(target))throw new Error("This campus service link is not valid.");const result=await api<Result>(`/v1/people/${product?"products":"services"}/${target}`);if(n===generation.current&&scope===current.current)setData(result);}catch(e){if(n===generation.current&&scope===current.current)setError(e instanceof Error?e.message:"This service could not load.");}finally{if(n===generation.current&&scope===current.current)setLoading(false);}},[scope,id,product]);
  useEffect(()=>{void load();return()=>{generation.current++;};},[load]);
  const text={fontFamily:theme.font.body,color:theme.text,fontSize:14,lineHeight:22};
  const money=(value:number)=>new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:0}).format(Number(value)/100);
  const items=data?.selectedProductId?data.products.filter(p=>p.id===data.selectedProductId):data?.products??[];
  return <SafeAreaView edges={["top","bottom"]} style={{flex:1,backgroundColor:theme.canvas}}><View style={{flex:1,width:"100%",maxWidth:660,alignSelf:"center"}}>
    <View style={{flexDirection:"row",alignItems:"center",padding:10,gap:8}}><Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={()=>router.canGoBack()?router.back():router.replace("/(tabs)/feed")} style={{padding:10}}><Ionicons name="arrow-back" color={theme.text} size={23}/></Pressable><Text style={{...text,fontFamily:theme.font.semibold,fontSize:17}}>Campus service</Text></View>
    {loading?<ScreenSkeleton/>:error?<View style={{padding:24,gap:18}}><Text accessibilityRole="alert" style={text}>{error}</Text><Pressable accessibilityRole="button" onPress={()=>void load()} style={{padding:12}}><Text style={{...text,color:theme.brand}}>Retry</Text></Pressable></View>:data?<ScrollView contentContainerStyle={{padding:20,paddingBottom:40}}>
      <Text style={{...text,fontFamily:theme.font.display,fontSize:28,lineHeight:34}}>{data.service.display_name}</Text>
      {data.service.biography?<Text style={{...text,marginTop:12}}>{data.service.biography}</Text>:null}
      <Pressable accessibilityRole="button" accessibilityLabel={`View ${data.service.owner_name}'s profile`} onPress={()=>router.push({pathname:"/student-profile",params:{id:data.service.user_id}})} style={{flexDirection:"row",alignItems:"center",gap:10,paddingVertical:18}}><ProfileAvatar name={data.service.owner_name} imageUrl={data.service.profile_image_url} size={38}/><View style={{flex:1}}><Text style={{...text,fontSize:11,color:theme.textMuted}}>Run by</Text><Text style={{...text,fontFamily:theme.font.semibold}}>{data.service.owner_name}</Text></View><Ionicons name="chevron-forward" size={17} color={theme.textMuted}/></Pressable>
      {data.service.agent_type==="VENDOR"?<><Text style={{...text,fontFamily:theme.font.semibold,fontSize:17,marginVertical:12}}>{data.selectedProductId?"Product":"Storefront"}</Text>{items.length?items.map(item=><View key={item.id} style={{marginBottom:24,borderBottomWidth:1,borderBottomColor:theme.border,paddingBottom:20}}>{item.image_url?<MediaImage uri={item.image_url} accessibilityLabel={item.name} style={{width:"100%",aspectRatio:1.4,borderRadius:14}} resizeMode="cover"/>:null}<Text style={{...text,fontFamily:theme.font.semibold,fontSize:18,marginTop:10}}>{item.name}</Text><Text style={{...text,color:theme.brand,fontFamily:theme.font.semibold}}>{money(item.price_kobo)}</Text><Text selectable style={{...text,marginTop:6}}>{item.description}</Text><Pressable accessibilityRole="button" onPress={()=>router.push({pathname:"/(tabs)/store",params:{product:item.id}})} style={{paddingVertical:14}}><Text style={{...text,color:theme.brand}}>View buying options →</Text></Pressable></View>):<Text style={text}>No products are available right now.</Text>}{data.selectedProductId?<Pressable accessibilityRole="button" onPress={()=>router.replace({pathname:"/student-service",params:{id:data.service.id}})} style={{paddingVertical:15}}><Text style={{...text,color:theme.brand}}>Visit the full storefront</Text></Pressable>:null}</>:null}
      {data.service.agent_type==="TUTOR"?<><Text style={{...text,fontFamily:theme.font.semibold,fontSize:17,marginVertical:12}}>Tutorials</Text>{data.tutorials.length?data.tutorials.map(item=><View key={item.id} style={{paddingVertical:16,borderBottomWidth:1,borderBottomColor:theme.border}}><Text style={{...text,fontFamily:theme.font.semibold,fontSize:17}}>{item.title}</Text><Text style={{...text,color:theme.textMuted}}>{item.course_code} · {money(item.price_kobo)}</Text><Text style={{...text,marginTop:8}}>{item.description}</Text><Pressable accessibilityRole="button" onPress={()=>router.push({pathname:"/(tabs)/tutorials",params:{listing:item.id}})} style={{paddingVertical:14}}><Text style={{...text,color:theme.brand}}>See availability →</Text></Pressable></View>):<Text style={text}>No tutorials are available right now.</Text>}</>:null}
      {data.service.agent_type==="RIDER"?<Text style={{...text,marginTop:12,color:theme.textMuted}}>Campus rider. Delivery requests are managed through the campus store, not through personal profile messages.</Text>:null}
    </ScrollView>:null}
  </View></SafeAreaView>;
}
