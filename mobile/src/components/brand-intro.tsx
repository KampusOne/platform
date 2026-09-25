import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAppearance } from "@/src/lib/appearance";

let played = false;

/** A short, once-per-cold-start brand sting. It never blocks touches or route loading. */
export function BrandIntro() {
  const { theme } = useAppearance();
  const [visible, setVisible] = useState(!played);
  const mark = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (played) {
      setVisible(false);
      return;
    }
    played = true;
    let alive = true;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (!alive) return;
        if (reduced) {
          setVisible(false);
          return;
        }

        Animated.sequence([
          Animated.timing(mark, {
            toValue: 1,
            duration: 320,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(word, {
            toValue: 1,
            duration: 220,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.delay(280),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 180,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start(() => {
          if (alive) setVisible(false);
        });
      })
      .catch(() => setVisible(false));

    return () => {
      alive = false;
      mark.stopAnimation();
      word.stopAnimation();
      opacity.stopAnimation();
    };
  }, [mark, opacity, word]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, styles.root, { opacity }]}
    >
      <View style={styles.lockup}>
        <Animated.View
          style={{
            opacity: mark,
            transform: [
              {
                scale: mark.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.86, 1],
                }),
              },
              {
                translateY: mark.interpolate({
                  inputRange: [0, 1],
                  outputRange: [9, 0],
                }),
              },
            ],
          }}
        >
          <Image
            source={require("@/assets/icon.png")}
            resizeMode="contain"
            style={styles.mark}
          />
        </Animated.View>
        <Animated.View
          style={{
            opacity: word,
            transform: [
              {
                translateY: word.interpolate({
                  inputRange: [0, 1],
                  outputRange: [5, 0],
                }),
              },
            ],
          }}
        >
          <Text style={[styles.wordmark, { fontFamily: theme.font.displayStrong }]}>
            KampusOne
          </Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#F1DFC8",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
  },
  lockup: { alignItems: "center", marginTop: -30 },
  mark: { width: 112, height: 120 },
  wordmark: {
    color: "#29231F",
    fontSize: 30,
    letterSpacing: -0.8,
    marginTop: 8,
  },
});
