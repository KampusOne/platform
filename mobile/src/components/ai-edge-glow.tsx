import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions } from "react-native";

/** A narrow flowing light along the perimeter; content and gestures stay clear. */
export function AIEdgeGlow({ active }: { active: boolean }) {
  const { width, height } = useWindowDimensions();
  const clock = useRef(new Animated.Value(0)).current;
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduced(value); }).catch(() => undefined);
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => { live = false; listener.remove(); };
  }, []);
  useEffect(() => {
    clock.stopAnimation(); clock.setValue(0);
    if (!active || reduced) return;
    const wave = Animated.loop(Animated.timing(clock, { toValue: 1, duration: 6500, easing: Easing.linear, useNativeDriver: true }));
    wave.start(); return () => wave.stop();
  }, [active, reduced, clock]);
  if (!active) return null;
  const count = 64;
  const perimeter = 2 * (width + height);
  const samples = Array.from({ length: 33 }, (_, index) => index / 32);
  return <Animated.View pointerEvents="none" accessible={false} style={[StyleSheet.absoluteFill, { zIndex: 999, overflow: "hidden" }]}>
    {Array.from({ length: count }, (_, index) => {
      const position = perimeter * index / count, length = perimeter / count + 1;
      const opacity = reduced ? .35 : clock.interpolate({ inputRange: samples, outputRange: samples.map(time => .15 + .7 * Math.pow((1 + Math.cos(2 * Math.PI * (time - index / count))) / 2, 3)) });
      const geometry = position < width ? { left: position, top: 0, width: length, height: 6 } : position < width + height ? { right: 0, top: position - width, width: 6, height: length } : position < 2 * width + height ? { right: position - width - height, bottom: 0, width: length, height: 6 } : { left: 0, bottom: position - 2 * width - height, width: 6, height: length };
      return <Animated.View key={index} style={[{ position: "absolute", backgroundColor: index % 3 ? "#C35D38" : "#E9B18E", opacity, shadowColor: "#C35D38", shadowOpacity: .6, shadowRadius: 12 }, geometry]} />;
    })}
  </Animated.View>;
}
