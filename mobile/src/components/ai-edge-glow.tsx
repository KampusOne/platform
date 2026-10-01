import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
} from "react-native";

type Glow = {
  color: string;
  width: number;
  height: number;
  startX: number;
  startY: number;
  travelX: number;
  travelY: number;
  delay: number;
};

export function AIEdgeGlow({ active }: { active: boolean }) {
  const { width, height } = useWindowDimensions();
  const clock = useRef(new Animated.Value(0)).current;
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (live) setReduced(value);
      })
      .catch(() => undefined);
    const listener = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      live = false;
      listener.remove();
    };
  }, []);

  useEffect(() => {
    clock.stopAnimation();
    clock.setValue(0);
    if (!active || reduced) return;
    const animation = Animated.loop(
      Animated.timing(clock, {
        toValue: 1,
        duration: 7600,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [active, reduced, clock]);

  const glows = useMemo<Glow[]>(
    () => [
      {
        color: "rgba(195,93,56,0.23)",
        width: Math.max(220, width * 0.78),
        height: 112,
        startX: -width * 0.45,
        startY: -54,
        travelX: width * 0.85,
        travelY: 18,
        delay: 0,
      },
      {
        color: "rgba(233,177,142,0.24)",
        width: 108,
        height: Math.max(280, height * 0.5),
        startX: width - 48,
        startY: height * 0.08,
        travelX: -12,
        travelY: height * 0.38,
        delay: 0.18,
      },
      {
        color: "rgba(137,88,62,0.18)",
        width: Math.max(240, width * 0.85),
        height: 118,
        startX: width * 0.28,
        startY: height - 58,
        travelX: -width * 0.58,
        travelY: -14,
        delay: 0.36,
      },
      {
        color: "rgba(219,151,115,0.2)",
        width: 102,
        height: Math.max(260, height * 0.44),
        startX: -54,
        startY: height * 0.46,
        travelX: 16,
        travelY: -height * 0.3,
        delay: 0.54,
      },
    ],
    [width, height],
  );

  if (!active) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      style={styles.overlay}
    >
      {glows.map((glow, index) => {
        const phase = reduced
          ? clock
          : Animated.modulo(
              Animated.add(clock, new Animated.Value(glow.delay)),
              1,
            );
        const translateX = phase.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0, glow.travelX, 0],
        });
        const translateY = phase.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0, glow.travelY, 0],
        });
        const scale = reduced
          ? 1
          : phase.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0.9, 1.16, 0.9],
            });
        const opacity = reduced
          ? 0.46
          : phase.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0.34, 0.82, 0.34],
            });
        return (
          <Animated.View
            key={index}
            style={[
              styles.glow,
              {
                backgroundColor: glow.color,
                width: glow.width,
                height: glow.height,
                left: glow.startX,
                top: glow.startY,
                opacity,
                transform: [{ translateX }, { translateY }, { scale }],
              },
            ]}
          />
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 999,
    overflow: "hidden",
  },
  glow: {
    position: "absolute",
    borderRadius: 999,
    shadowColor: "#C35D38",
    shadowOpacity: 0.35,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 9,
  },
});
