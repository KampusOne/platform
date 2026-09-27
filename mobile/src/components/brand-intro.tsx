import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, Text, View } from "react-native";
import { SplashScreen } from "expo-router";
import { useAppearance } from "@/src/lib/appearance";

/** Branded ~2s launch motion. It is intentionally independent of network/session loading. */
export function BrandIntro({ fontsReady, appearanceReady }: { fontsReady: boolean; appearanceReady: boolean }) {
  const { theme, isDark } = useAppearance();
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [animationDone, setAnimationDone] = useState(false);
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [deadlineReached, setDeadlineReached] = useState(false);
  const mark = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const tagline = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const nativeHidden = useRef(false);
  const ready =
    deadlineReached ||
    (fontsReady && appearanceReady && animationDone && minimumElapsed);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (!alive) return;
      setReduced(value);
      if (value) { mark.setValue(1); word.setValue(1); tagline.setValue(1); setAnimationDone(true); return; }
      Animated.stagger(100, [mark, word, tagline].map((value, index) => Animated.timing(value, {
        toValue: 1, duration: index === 0 ? 440 : 340,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }))).start(() => { if (alive) setAnimationDone(true); });
    }).catch(() => { if (alive) { mark.setValue(1); word.setValue(1); tagline.setValue(1); setAnimationDone(true); } });
    const minimumTimer = setTimeout(() => setMinimumElapsed(true), reduced ? 900 : 1_800);
    const deadlineTimer = setTimeout(() => setDeadlineReached(true), 2_400);
    return () => {
      alive = false;
      clearTimeout(minimumTimer);
      clearTimeout(deadlineTimer);
      [mark, word, tagline].forEach(value => value.stopAnimation());
    };
  }, [mark, word, tagline, reduced]);

  useEffect(() => {
    if (!ready || !visible) return;
    const animation = Animated.timing(opacity, { toValue: 0, duration: reduced ? 0 : 160, useNativeDriver: true });
    animation.start(({ finished }) => { if (finished) setVisible(false); });
    return () => animation.stop();
  }, [ready, reduced, visible, opacity]);

  if (!visible) return null;
  return (
    <Animated.View accessibilityLabel="Opening KampusOne" accessibilityViewIsModal
      onLayout={() => {
        if (nativeHidden.current) return;
        nativeHidden.current = true;
        void SplashScreen.hideAsync().catch(() => undefined);
      }}
      style={[StyleSheet.absoluteFill, styles.root, { opacity, backgroundColor: theme.canvas }]}
    >
      <View style={styles.lockup}>
        <Animated.View style={{ opacity: mark, transform: [{ scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }, { translateY: mark.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
          <Image accessibilityIgnoresInvertColors source={require("@/assets/brand/kampusone-symbol-solid.png")} resizeMode="contain" style={[styles.mark, isDark && { tintColor: theme.brand }]} />
        </Animated.View>
        <Animated.View style={[styles.textLine, { opacity: word, transform: [{ translateY: word.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
          <Text
            android_hyphenationFrequency="none"
            numberOfLines={1}
            style={[styles.wordmark, { color: theme.text, fontFamily: fontsReady ? theme.font.displayStrong : undefined }]}
            textBreakStrategy="simple"
          >
            KampusOne
          </Text>
        </Animated.View>
        <Animated.View style={[styles.textLine, { opacity: tagline, transform: [{ translateY: tagline.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
          <Text
            android_hyphenationFrequency="none"
            numberOfLines={1}
            style={[styles.tagline, { color: theme.brand, fontFamily: fontsReady ? "Caveat_600SemiBold" : undefined }]}
            textBreakStrategy="simple"
          >
            Already Ready for School
          </Text>
        </Animated.View>

      </View>
    </Animated.View>
  );
}
const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    zIndex: 10000,
  },
  lockup: {
    alignItems: "center",
    marginTop: -30,
    maxWidth: 420,
    width: "100%",
  },
  textLine: { alignItems: "center", width: "100%" },
  mark: { width: 142, height: 142 },
  wordmark: {
    fontSize: 42,
    letterSpacing: -1.2,
    lineHeight: 52,
    marginTop: 12,
    paddingHorizontal: 8,
    textAlign: "center",
    width: "100%",
  },
  tagline: {
    fontSize: 28,
    lineHeight: 38,
    marginTop: 2,
    paddingHorizontal: 4,
    paddingVertical: 2,
    textAlign: "center",
    width: "100%",
  },
});
