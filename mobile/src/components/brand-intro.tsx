import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, Text, View } from "react-native";
import { SplashScreen } from "expo-router";
import { useAppearance } from "@/src/lib/appearance";

/** Brief launch motion. Network requests render in the destination, never behind the logo. */
export function BrandIntro({ fontsReady, appearanceReady }: { fontsReady: boolean; appearanceReady: boolean }) {
  const { theme, isDark } = useAppearance();
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [animationDone, setAnimationDone] = useState(false);
  const [deadlineReached, setDeadlineReached] = useState(false);
  const mark = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const tagline = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const nativeHidden = useRef(false);
  const ready = (fontsReady && appearanceReady && animationDone) || deadlineReached;

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
    const timer = setTimeout(() => setDeadlineReached(true), 1200);
    return () => { alive = false; clearTimeout(timer); [mark, word, tagline].forEach(value => value.stopAnimation()); };
  }, [mark, word, tagline]);

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
        <Animated.View style={{ opacity: word, transform: [{ translateY: word.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
          <Text style={[styles.wordmark, { color: theme.text, fontFamily: fontsReady ? theme.font.displayStrong : undefined }]}>KampusOne</Text>
        </Animated.View>
        <Animated.View style={{ opacity: tagline, transform: [{ translateY: tagline.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
          <Text style={[styles.tagline, { color: theme.brand, fontFamily: fontsReady ? "Caveat_600SemiBold" : undefined }]}>Already Ready for School</Text>
        </Animated.View>

      </View>
    </Animated.View>
  );
}
const styles = StyleSheet.create({
  root: { alignItems: "center", justifyContent: "center", zIndex: 10000 },
  lockup: { alignItems: "center", marginTop: -30 },
  mark: { width: 142, height: 142 },
  wordmark: { fontSize: 42, letterSpacing: -1.2, marginTop: 12 },
  tagline: { fontSize: 28, marginTop: 7 },
});
