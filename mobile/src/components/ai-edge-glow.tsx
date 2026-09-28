import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";

const READY_PALETTE = ["#A8462E", "#C35D38", "#D9855F", "#E9B18E", "#F1DFC8"] as const;
const PATH = [0, 0.25, 0.5, 0.75, 1];

type Corner = { x: number; y: number };

function phasedPath(corners: Corner[], phase: number) {
  const start = phase % corners.length;
  const ordered = [...corners.slice(start), ...corners.slice(0, start)];
  return [...ordered, ordered[0]];
}

function SoftLight({
  progress,
  color,
  phase,
  size,
  width,
  height,
  reduceMotion,
}: {
  progress: Animated.Value;
  color: string;
  phase: number;
  size: number;
  width: number;
  height: number;
  reduceMotion: boolean;
}) {
  const corners = useMemo<Corner[]>(
    () => [
      { x: -size * 0.52, y: -size * 0.58 },
      { x: width - size * 0.48, y: -size * 0.58 },
      { x: width - size * 0.48, y: height - size * 0.48 },
      { x: -size * 0.52, y: height - size * 0.48 },
    ],
    [height, size, width],
  );

  const path = useMemo(() => phasedPath(corners, phase), [corners, phase]);
  const translateX = progress.interpolate({
    inputRange: PATH,
    outputRange: path.map((point) => point.x),
  });
  const translateY = progress.interpolate({
    inputRange: PATH,
    outputRange: path.map((point) => point.y),
  });
  const scale = progress.interpolate({
    inputRange: PATH,
    outputRange: reduceMotion ? [1, 1, 1, 1, 1] : [0.92, 1.08, 0.96, 1.05, 0.92],
  });
  const opacity = progress.interpolate({
    inputRange: PATH,
    outputRange: reduceMotion ? [0.5, 0.5, 0.5, 0.5, 0.5] : [0.46, 0.7, 0.52, 0.64, 0.46],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.light,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          opacity,
          transform: [{ translateX }, { translateY }, { scale }],
        },
      ]}
    >
      <View
        style={[
          styles.layer,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            opacity: 0.035,
          },
        ]}
      />
      <View
        style={[
          styles.layer,
          {
            width: size * 0.76,
            height: size * 0.76,
            borderRadius: size,
            backgroundColor: color,
            opacity: 0.052,
          },
        ]}
      />
      <View
        style={[
          styles.layer,
          {
            width: size * 0.52,
            height: size * 0.52,
            borderRadius: size,
            backgroundColor: color,
            opacity: 0.075,
          },
        ]}
      />
      <View
        style={[
          styles.layer,
          {
            width: size * 0.31,
            height: size * 0.31,
            borderRadius: size,
            backgroundColor: color,
            opacity: 0.1,
          },
        ]}
      />
    </Animated.View>
  );
}

/**
 * Soft, non-blocking Kira activity glow.
 *
 * The light deliberately behaves like a moving field instead of a colored
 * outline: several oversized, feathered KampusOne tones travel around the
 * perimeter and softly bloom into the canvas as Kira listens, transcribes,
 * or works on a response.
 */
export function AIEdgeGlow({ active }: { active: boolean }) {
  const { width, height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
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
    fade.stopAnimation();

    if (!active) {
      Animated.timing(fade, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(fade, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [active, fade]);

  useEffect(() => {
    progress.stopAnimation();

    if (!active || reduceMotion) {
      progress.setValue(0.08);
      return;
    }

    progress.setValue(0);
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 7600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    loop.start();
    return () => loop.stop();
  }, [active, progress, reduceMotion]);

  const size = Math.max(220, Math.min(width, height) * 0.82);

  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      style={[StyleSheet.absoluteFill, styles.container, { opacity: fade }]}
    >
      {READY_PALETTE.map((color, index) => (
        <SoftLight
          key={color}
          progress={progress}
          color={color}
          phase={index % 4}
          size={size * (index === 4 ? 0.9 : 1)}
          width={width}
          height={height}
          reduceMotion={reduceMotion}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    zIndex: 999,
    elevation: 30,
    overflow: "hidden",
  },
  light: {
    position: "absolute",
    left: 0,
    top: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  layer: {
    position: "absolute",
  },
});
