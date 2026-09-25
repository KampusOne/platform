import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import { useAppearance } from "@/src/lib/appearance";

/** Screen-edge state indicator; never intercepts taps or blocks the composer. */
export function AIEdgeGlow({ active }: { active: boolean }) {
  const { theme } = useAppearance();
  const opacity = useRef(new Animated.Value(0.78)).current;
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
      opacity.setValue(0.78);
      return;
    }

    if (reduceMotion) {
      opacity.setValue(0.76);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.94,
          duration: 2400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.64,
          duration: 3000,
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
        The glow is intentionally built from many low-opacity layers so it
        dissolves into the screen instead of reading as a hard border.
        Each side carries a slightly different accent, while the inner layers
        return to KampusOne's warm brand tones.
      */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.rounded,
          {
            borderWidth: 56,
            borderTopColor: "#63D8FF",
            borderRightColor: "#8CF0B7",
            borderBottomColor: "#9E83FF",
            borderLeftColor: "#FF73B3",
            opacity: 0.018,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.rounded,
          {
            borderWidth: 46,
            borderTopColor: "#72DEFF",
            borderRightColor: "#9DF6B9",
            borderBottomColor: "#B09AFF",
            borderLeftColor: "#FF83BA",
            opacity: 0.024,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.rounded,
          {
            borderWidth: 38,
            borderTopColor: "#8ADFFF",
            borderRightColor: "#B1F5C5",
            borderBottomColor: "#BDA9FF",
            borderLeftColor: "#FF99C4",
            opacity: 0.032,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.rounded,
          {
            borderWidth: 31,
            borderTopColor: "#F5D87C",
            borderRightColor: "#A4EBC1",
            borderBottomColor: "#AD94F6",
            borderLeftColor: "#F69ABF",
            opacity: 0.04,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.rounded,
          {
            borderWidth: 25,
            borderTopColor: theme.peach,
            borderRightColor: "#9AE9C1",
            borderBottomColor: theme.clay,
            borderLeftColor: "#F38CB4",
            opacity: 0.048,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.rounded,
          {
            borderWidth: 19,
            borderTopColor: theme.peach,
            borderRightColor: theme.clay,
            borderBottomColor: "#9F86E8",
            borderLeftColor: theme.clay,
            opacity: 0.06,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.rounded,
          {
            borderWidth: 14,
            borderTopColor: theme.clay,
            borderRightColor: theme.brand,
            borderBottomColor: theme.brand,
            borderLeftColor: theme.clay,
            opacity: 0.075,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.rounded,
          {
            borderWidth: 10,
            borderColor: theme.brand,
            opacity: 0.085,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.rounded,
          {
            borderWidth: 7,
            borderColor: theme.peach,
            opacity: 0.095,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.rounded,
          {
            borderWidth: 4,
            borderColor: theme.brand,
            opacity: 0.11,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.rounded,
          {
            borderWidth: 2,
            borderColor: theme.peach,
            opacity: 0.14,
          },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    zIndex: 999,
    elevation: 30,
  },
  rounded: {
    borderRadius: 30,
  },
});
