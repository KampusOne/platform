import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { useAppearance } from "@/src/lib/appearance";
/** Screen-edge state indicator; never intercepts taps or blocks the composer. */
export function AIEdgeGlow({active}:{active:boolean}) {
  const {theme}=useAppearance(); const opacity=useRef(new Animated.Value(0.5)).current;
  const [reduce,setReduce]=useState(true);
  useEffect(()=>{let live=true; void AccessibilityInfo.isReduceMotionEnabled().then(v=>{if(live)setReduce(v);}).catch(()=>undefined);const listener=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduce);return()=>{live=false;listener.remove();};},[]);
  useEffect(()=>{if(!active||reduce){opacity.setValue(0.55);return;}const loop=Animated.loop(Animated.sequence([Animated.timing(opacity,{toValue:0.9,duration:1400,easing:Easing.inOut(Easing.ease),useNativeDriver:true}),Animated.timing(opacity,{toValue:0.35,duration:1400,easing:Easing.inOut(Easing.ease),useNativeDriver:true})]));loop.start();return()=>loop.stop();},[active,reduce,opacity]);
  if(!active)return null;
  const gradient=(direction:string,colors:string[]):ViewStyle=>{
    const value=`linear-gradient(${direction}, ${colors.join(", ")})`;
    return Platform.OS==='web'?{backgroundImage:value} as ViewStyle:{experimental_backgroundImage:value};
  };
  return <Animated.View pointerEvents="none" accessible={false} style={[StyleSheet.absoluteFill,{zIndex:20,opacity}]}>
    {[{width:18,alpha:0.05},{width:9,alpha:0.13},{width:3,alpha:0.8}].map(layer=><View pointerEvents="none" key={layer.width} style={[StyleSheet.absoluteFill,{opacity:layer.alpha}]}>
      <View style={[{position:'absolute',top:0,left:0,right:0,height:layer.width},gradient('90deg',[theme.peach,theme.brand,theme.clay,theme.deepBrand])]}/>
      <View style={[{position:'absolute',bottom:0,left:0,right:0,height:layer.width},gradient('90deg',[theme.deepBrand,theme.clay,theme.peach,theme.brand])]}/>
      <View style={[{position:'absolute',top:0,bottom:0,left:0,width:layer.width},gradient('180deg',[theme.peach,theme.brand,theme.deepBrand])]}/>
      <View style={[{position:'absolute',top:0,bottom:0,right:0,width:layer.width},gradient('180deg',[theme.deepBrand,theme.peach,theme.brand])]}/>
    </View>)}
  </Animated.View>;
}
