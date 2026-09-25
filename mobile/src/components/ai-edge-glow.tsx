import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import { useAppearance } from "@/src/lib/appearance";

/** Screen-edge state indicator; never intercepts taps or blocks the composer. */
export function AIEdgeGlow({ active }: { active: boolean }) {
  const { theme } = useAppearance();
  const opacity = useRef(new Animated.Value(0.82)).current;
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
      opacity.setValue(0.82);
      return;
    }

    if (reduceMotion) {
      opacity.setValue(0.8);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.96,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.68,
          duration: 2400,
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
      style={[StyleSheet.absoluteFill, styles.container, { opacity }]}
    >
      {/*
        Build the edge state as a soft, layered falloff instead of a few
        high-opacity borders. The widest bands are intentionally faint so the
        glow dissolves into the screen rather than reading as a picture frame.
      */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderWidth: 42, borderColor: theme.peach, opacity: 0.025 }]}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderWidth: 32, borderColor: theme.peach, opacity: 0.035 }]}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderWidth: 24, borderColor: theme.clay, opacity: 0.05 }]}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderWidth: 17, borderColor: theme.clay, opacity: 0.065 }]}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderWidth: 11, borderColor: theme.brand, opacity: 0.085 }]}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderWidth: 7, borderColor: theme.brand, opacity: 0.11 }]}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderWidth: 4, borderColor: theme.peach, opacity: 0.14 }]}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderWidth: 2, borderColor: theme.brand, opacity: 0.2 }]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    zIndex: 999,
    elevation: 30,
  },
});
