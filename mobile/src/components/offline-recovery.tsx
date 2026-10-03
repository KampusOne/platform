import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Network from 'expo-network';
import { useAppearance } from '@/src/lib/appearance';

/** A disconnected device has one recovery screen; server errors do not set it offline. */
export function OfflineRecovery(){
 const {theme}=useAppearance();
 const [offline,setOffline]=useState(false),[dismissed,setDismissed]=useState(false),[checking,setChecking]=useState(false);
 useEffect(()=>{
  let live=true;
  const accept=(state:Network.NetworkState)=>{if(!live)return;const next=state.isConnected===false||state.isInternetReachable===false;setOffline(next);if(!next)setDismissed(false);};
  void Network.getNetworkStateAsync().then(accept).catch(()=>undefined);
  const network=Network.addNetworkStateListener(accept);
  const app=AppState.addEventListener('change',state=>{if(state==='active')void Network.getNetworkStateAsync().then(accept).catch(()=>undefined);});
  return()=>{live=false;network.remove();app.remove();};
 },[]);
 async function retry(){setChecking(true);try{const state=await Network.getNetworkStateAsync();setOffline(state.isConnected===false||state.isInternetReachable===false);}finally{setChecking(false);}}
 if(!offline||dismissed)return null;
 return <SafeAreaView accessibilityViewIsModal style={[StyleSheet.absoluteFill,{backgroundColor:theme.canvas,zIndex:999,elevation:99}]}><View style={{flex:1,justifyContent:'center',alignItems:'center',padding:28,gap:14}}>
  <Ionicons name="cloud-offline-outline" size={48} color={theme.deepBrand}/><Text accessibilityRole="header" style={{fontFamily:theme.font.display,fontSize:25,color:theme.text}}>You’re offline</Text>
  <Text style={{fontFamily:theme.font.body,fontSize:14,lineHeight:22,textAlign:'center',color:theme.textMuted,maxWidth:330}}>Turn on mobile data or Wi-Fi to reconnect. Your account and saved work are still here.</Text>
  <Pressable accessibilityRole="button" disabled={checking} onPress={()=>void retry().catch(()=>undefined)} style={{minHeight:48,backgroundColor:theme.deepBrand,paddingHorizontal:28,justifyContent:'center',borderRadius:12}}><Text style={{color:'#FFFFFF',fontFamily:theme.font.semibold}}>{checking?'Checking connection…':'Try again'}</Text></Pressable>
  <Pressable accessibilityRole="button" onPress={()=>setDismissed(true)} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:theme.accentText,fontFamily:theme.font.medium}}>View saved content</Text></Pressable>
 </View></SafeAreaView>;
}
