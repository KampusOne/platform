import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Easing, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

// Light lives at the fixed perimeter. No translated filled views cross the chat.
const lights = ["195,93,56", "233,177,142", "217,133,95", "168,70,46"] as const;
const sides = ["top", "right", "bottom", "left"] as const;
export function AIEdgeGlow({ active }: { active: boolean }) {
  const phase = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const [reduced, setReduced] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduced(value); }).catch(() => undefined);
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    const app = AppState.addEventListener("change", value => setForeground(value === "active"));
    return () => { live = false; motion.remove(); app.remove(); };
  }, []);
  useEffect(() => {
    const fade = Animated.timing(reveal, { toValue: active && foreground ? 1 : 0, duration: reduced ? 0 : 280, useNativeDriver: true });
    fade.start();
    return () => fade.stop();
  }, [active, foreground, reduced, reveal]);
  useEffect(() => {
    phase.stopAnimation();
    if (!active || !foreground || reduced) { phase.setValue(0); return; }
    const animation = Animated.loop(Animated.timing(phase, { toValue: 4, duration: 6400, easing: Easing.linear, useNativeDriver: true }));
    animation.start();
    return () => animation.stop();
  }, [active, foreground, reduced, phase]);
  return (
    <Animated.View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.overlay, { opacity: reveal }]}>
      {sides.flatMap((side, index) => {
        const horizontal = side === "top" || side === "bottom";
        const reverse = side === "bottom" || side === "right";
        const localPhase = Animated.modulo(Animated.add(phase,index),4);
        // Crossfade actual colours around the stationary perimeter. Each gradient
        // fades to alpha zero inward, leaving the entire chat centre transparent.
        return lights.map((colour, light) => {
          const colours = [`rgba(${colour},0.56)`, `rgba(${colour},0.24)`, `rgba(${colour},0.07)`, `rgba(${colour},0)`] as const;
          const weights = [0,1,2,3,4].map(step => step % 4 === light ? 0.78 : 0);
          const opacity = reduced ? (light === index ? 0.6 : 0) : localPhase.interpolate({ inputRange:[0,1,2,3,4], outputRange:weights });
          return <Animated.View key={`${side}.${light}`} style={[styles.edge, horizontal ? styles.horizontal : styles.vertical, { [side]:0, opacity }]}>
            <LinearGradient colors={reverse ? [colours[3],colours[2],colours[1],colours[0]] : colours} locations={[0,0.18,0.52,1]} start={{x:0,y:0}} end={horizontal ? {x:0,y:1} : {x:1,y:0}} style={StyleSheet.absoluteFill}/>
          </Animated.View>;
        });
      })}
      <View style={styles.core}/>
    </Animated.View>
  );
}
const styles=StyleSheet.create({
  overlay:{position:"absolute",top:0,right:0,bottom:0,left:0,zIndex:999,overflow:"hidden",borderRadius:24},
  edge:{position:"absolute"},
  horizontal:{left:0,right:0,height:20},
  vertical:{top:0,bottom:0,width:20},
  core:{position:"absolute",top:0,right:0,bottom:0,left:0,borderRadius:24,borderWidth:1.5,borderColor:"rgba(217,133,95,0.18)"},
});
