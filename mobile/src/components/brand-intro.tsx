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

export function BrandIntro({ ready = true }: { ready?: boolean }) {
  const { theme } = useAppearance();
  const [visible, setVisible] = useState(!played);
  const [reducedMotion, setReducedMotion] = useState(false);
  const mark = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const tagline = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const exitStarted = useRef(false);

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
        setReducedMotion(reduced);
        if (reduced) {
          mark.setValue(1);
          word.setValue(1);
          tagline.setValue(1);
          return;
        }
        Animated.spring(mark, {
          toValue: 1,
          speed: 16,
          bounciness: 6,
          useNativeDriver: true,
        }).start();
      })
      .catch(() => {
        mark.setValue(1);
      });
    return () => {
      alive = false;
      mark.stopAnimation();
      word.stopAnimation();
      tagline.stopAnimation();
      opacity.stopAnimation();
    };
  }, [mark, opacity, tagline, word]);

  useEffect(() => {
    if (!visible || !ready || exitStarted.current) return;
    exitStarted.current = true;

    const finish = () => {
      Animated.sequence([
        Animated.parallel([
          Animated.timing(word, {
            toValue: 1,
            duration: reducedMotion ? 0 : 260,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(tagline, {
            toValue: 1,
            duration: reducedMotion ? 0 : 320,
            delay: reducedMotion ? 0 : 80,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.delay(reducedMotion ? 120 : 620),
        Animated.timing(opacity, {
          toValue: 0,
          duration: reducedMotion ? 120 : 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => setVisible(false));
    };

    const minimum = setTimeout(finish, reducedMotion ? 0 : 380);
    return () => clearTimeout(minimum);
  }, [opacity, ready, reducedMotion, tagline, visible, word]);

  useEffect(() => {
    if (!visible) return;
    const failSafe = setTimeout(() => {
      if (exitStarted.current) return;
      exitStarted.current = true;
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start(() => setVisible(false));
    }, 3200);
    return () => clearTimeout(failSafe);
  }, [opacity, visible]);

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
                  outputRange: [0.72, 1],
                }),
              },
              {
                rotate: mark.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["-3deg", "0deg"],
                }),
              },
              {
                translateY: mark.interpolate({
                  inputRange: [0, 1],
                  outputRange: [16, 0],
                }),
              },
            ],
          }}
        >
          <Image
            source={require("@/assets/splash-mark.png")}
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
                  outputRange: [9, 0],
                }),
              },
            ],
          }}
        >
          <Text
            style={[
              styles.wordmark,
              ready ? { fontFamily: theme.font.displayStrong } : undefined,
            ]}
          >
            KampusOne
          </Text>
        </Animated.View>

        <Animated.View
          style={{
            opacity: tagline,
            transform: [
              {
                translateY: tagline.interpolate({
                  inputRange: [0, 1],
                  outputRange: [8, 0],
                }),
              },
            ],
          }}
        >
          <Text
            style={[
              styles.tagline,
              ready ? { fontFamily: theme.font.calligraphy } : undefined,
            ]}
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
    backgroundColor: "#F1DFC8",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
  },
  lockup: { alignItems: "center", marginTop: -24 },
  mark: { width: 154, height: 154 },
  wordmark: {
    color: "#29231F",
    fontSize: 37,
    fontWeight: "900",
    letterSpacing: -1.2,
    marginTop: -5,
  },
  tagline: {
    color: "#A8462E",
    fontSize: 16,
    fontStyle: "italic",
    letterSpacing: 0.1,
    marginTop: 7,
  },
});
