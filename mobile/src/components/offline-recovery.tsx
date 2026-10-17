import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Network from 'expo-network';
import { useAppearance } from '@/src/lib/appearance';
import { setNetworkOffline } from '@/src/lib/network-state';

/** A disconnected device has one recovery screen; server errors do not set it offline. */
export function OfflineRecovery(){
 const {theme}=useAppearance();
 const [offline,setOffline]=useState(false),[dismissed,setDismissed]=useState(false),[checking,setChecking]=useState(false);
 useEffect(()=>{
  let live=true;
  const accept=(state:Network.NetworkState)=>{if(!live)return;const next=state.isConnected===false||state.isInternetReachable===false;setNetworkOffline(next);setOffline(next);if(!next)setDismissed(false);};
  void Network.getNetworkStateAsync().then(accept).catch(()=>undefined);
  const network=Network.addNetworkStateListener(accept);
  const app=AppState.addEventListener('change',state=>{if(state==='active')void Network.getNetworkStateAsync().then(accept).catch(()=>undefined);});
  return()=>{live=false;network.remove();app.remove();};
 },[]);
 async function retry(){setChecking(true);try{const state=await Network.getNetworkStateAsync();setOffline(state.isConnected===false||state.isInternetReachable===false);}finally{setChecking(false);}}
 if(!offline||dismissed)return null;
 return <SafeAreaView edges={["top"]} pointerEvents="box-none" style={{position:'absolute',top:0,left:0,right:0,zIndex:999}}><View style={{maxWidth:540,alignSelf:'center',width:'100%',backgroundColor:theme.surface,borderBottomWidth:1,borderColor:theme.border,paddingHorizontal:16,paddingVertical:10,flexDirection:'row',alignItems:'center',gap:10}}>
  <Ionicons name="cloud-offline-outline" size={22} color={theme.deepBrand}/>
  <View style={{flex:1,gap:3}}><Text accessibilityLiveRegion="polite" style={{fontFamily:theme.font.semibold,color:theme.text,fontSize:14}}>You’re offline</Text><Text style={{fontFamily:theme.font.body,color:theme.textMuted,fontSize:12,lineHeight:17}}>Saved content is available. Changes need a connection.</Text></View>
  <Pressable accessibilityRole="button" disabled={checking} onPress={()=>void retry().catch(()=>undefined)} style={{minHeight:44,justifyContent:'center',paddingHorizontal:8}}><Text style={{color:theme.accentText,fontFamily:theme.font.medium}}>{checking?'Checking…':'Retry'}</Text></Pressable>
  <Pressable accessibilityRole="button" accessibilityLabel="Dismiss offline notice" onPress={()=>setDismissed(true)} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="close" size={20} color={theme.textMuted}/></Pressable>
 </View></SafeAreaView>;
}
