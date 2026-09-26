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
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";

let played = false;

const INTRO_MIN_MS = 1_900;
const INTRO_FADE_MS = 260;

/**
 * One clean cold-start brand transition. It stays above route/session loading so
 * users never see implementation loaders between the native splash and the app.
 */
export function BrandIntro() {
  const { theme } = useAppearance();
  const { state, profileState, sessionRestoreError, profileError } = useAuth();
  const [visible, setVisible] = useState(!played);
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [motionComplete, setMotionComplete] = useState(false);
  const mark = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const tagline = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const dismissing = useRef(false);

  const appReady =
    state === "anonymous" ||
    Boolean(sessionRestoreError) ||
    (state === "authenticated" &&
      (profileState === "ready" ||
        profileState === "error" ||
        Boolean(profileError)));

  useEffect(() => {
    if (played) {
      setVisible(false);
      return;
    }
    played = true;

    let alive = true;
    const minimumTimer = setTimeout(() => {
      if (alive) setMinimumElapsed(true);
    }, INTRO_MIN_MS);

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (!alive) return;
        if (reduced) {
          mark.setValue(1);
          word.setValue(1);
          tagline.setValue(1);
          setMotionComplete(true);
          return;
        }

        Animated.sequence([
          Animated.timing(mark, {
            toValue: 1,
            duration: 520,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.parallel([
            Animated.timing(word, {
              toValue: 1,
              duration: 340,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.sequence([
              Animated.delay(110),
              Animated.timing(tagline, {
                toValue: 1,
                duration: 320,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
              }),
            ]),
          ]),
        ]).start(({ finished }) => {
          if (alive && finished) setMotionComplete(true);
        });
      })
      .catch(() => {
        mark.setValue(1);
        word.setValue(1);
        tagline.setValue(1);
        if (alive) setMotionComplete(true);
      });

    return () => {
      alive = false;
      clearTimeout(minimumTimer);
      mark.stopAnimation();
      word.stopAnimation();
      tagline.stopAnimation();
      opacity.stopAnimation();
    };
  }, [mark, opacity, tagline, word]);

  useEffect(() => {
    if (
      !visible ||
      !minimumElapsed ||
      !motionComplete ||
      !appReady ||
      dismissing.current
    )
      return;

    dismissing.current = true;
    Animated.timing(opacity, {
      toValue: 0,
      duration: INTRO_FADE_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(() => setVisible(false));
  }, [appReady, minimumElapsed, motionComplete, opacity, visible]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="box-only"
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
                  outputRange: [0.76, 1],
                }),
              },
              {
                translateY: mark.interpolate({
                  inputRange: [0, 1],
                  outputRange: [18, 0],
                }),
              },
            ],
          }}
        >
          <Image
            source={require("@/assets/adaptive-icon-foreground.png")}
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
                  outputRange: [12, 0],
                }),
              },
            ],
          }}
        >
          <Text
            style={[
              styles.wordmark,
              { fontFamily: theme.font.displayStrong },
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
            style={[styles.tagline, { fontFamily: theme.font.calligraphy }]}
          >
            ready for school
          </Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    backgroundColor: "#F1DFC8",
    justifyContent: "center",
    zIndex: 10_000,
  },
  lockup: {
    alignItems: "center",
    marginTop: -24,
  },
  mark: {
    height: 260,
    width: 260,
  },
  wordmark: {
    color: "#29231F",
    fontSize: 38,
    letterSpacing: -1.25,
    marginTop: -24,
  },
  tagline: {
    color: "#A8462E",
    fontSize: 21,
    letterSpacing: 0.2,
    marginTop: 8,
  },
});
