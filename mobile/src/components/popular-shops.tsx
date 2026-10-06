import { useCallback, useState } from "react";
import { router,useFocusEffect } from "expo-router";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { useAppearance } from "@/src/lib/appearance";
type Shop={id:string;agent_type:'VENDOR'|'TUTOR'|'RIDER';display_name:string;profile_image_url:string|null};
export function PopularShops({selected,onSelect}:{selected:string|null;onSelect:(id:string|null)=>void}){
 const{theme}=useAppearance();const[shops,setShops]=useState<Shop[]>([]),[error,setError]=useState("");
 const load=useCallback(async()=>{try{const r=await api<{brands:Shop[]}>("/v1/featured-brands/public");setShops(r.brands);setError("");}catch{setError("Top campus brands could not load. Tap to retry.");}},[]);
 useFocusEffect(useCallback(()=>{void load();},[load]));
 if(error)return <Pressable accessibilityRole="button" onPress={()=>void load()} style={{paddingVertical:12}}><Text style={{color:theme.textMuted,fontFamily:theme.font.body,fontSize:12}}>{error}</Text></Pressable>;
 if(!shops.length)return null;
 return <View style={{marginBottom:20}}><View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><Text style={{fontFamily:theme.font.semibold,fontSize:17,color:theme.text}}>Top campus brands</Text>{selected&&<Pressable accessibilityRole="button" onPress={()=>onSelect(null)}><Text style={{color:theme.brand,fontFamily:theme.font.semibold}}>All products</Text></Pressable>}</View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:18}}>{shops.map(shop=><Pressable key={shop.id} accessibilityRole="button" accessibilityLabel={`Shop ${shop.display_name}`} accessibilityState={{selected:selected===shop.id}} onPress={()=>{if(shop.agent_type!=="VENDOR")router.push({pathname:"/student-service",params:{id:shop.id}});else onSelect(selected===shop.id?null:shop.id);}} style={{width:78,alignItems:"center",gap:7}}><View style={{width:68,height:68,borderRadius:34,borderWidth:2,borderColor:theme.brand,padding:4}}>{shop.profile_image_url?<Image source={{uri:shop.profile_image_url}} style={{width:"100%",height:"100%",borderRadius:30}}/>:<View style={{flex:1,borderRadius:30,backgroundColor:theme.surfaceMuted,justifyContent:"center",alignItems:"center"}}><Ionicons name="storefront-outline" size={26} color={theme.brand}/></View>}</View><Text numberOfLines={2} style={{fontFamily:theme.font.medium,fontSize:12,textAlign:"center",color:theme.text}}>{shop.display_name}</Text></Pressable>)}</ScrollView></View>;
}
