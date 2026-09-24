import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import { useAppearance } from "@/src/lib/appearance";

/** Screen-edge state indicator; never intercepts taps or blocks the composer. */
export function AIEdgeGlow({ active }: { active: boolean }) {
  const { theme } = useAppearance();
  const opacity = useRef(new Animated.Value(0.72)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (live) setReduceMotion(enabled);
      })
      .catch(() => undefined);

    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      live = false;
      listener.remove();
    };
  }, []);

  useEffect(() => {
    if (!active) {
      opacity.stopAnimation();
      opacity.setValue(0.72);
      return;
    }

    if (reduceMotion) {
      opacity.setValue(0.78);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.98,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [active, reduceMotion, opacity]);

  if (!active) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      style={[StyleSheet.absoluteFill, { zIndex: 999, elevation: 30, opacity }]}
    >
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderWidth: 18, borderColor: theme.peach, opacity: 0.12 }]}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderWidth: 10, borderColor: theme.clay, opacity: 0.22 }]}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderWidth: 4, borderColor: theme.brand, opacity: 0.82 }]}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderWidth: 1, borderColor: theme.deepBrand, opacity: 0.95 }]}
      />
    </Animated.View>
  );
}
