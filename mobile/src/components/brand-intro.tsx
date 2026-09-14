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
/** Runs once per cold start. Touches pass through; no artificial loading gate. */
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
          Animated.stagger(75, [
            Animated.timing(mark, {
              toValue: 1,
              duration: 240,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(word, {
              toValue: 1,
              duration: 240,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 180,
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
  }, [mark, word, opacity]);
  if (!visible) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: theme.canvas,
          alignItems: "center",
          justifyContent: "center",
          opacity,
        },
      ]}
    >
      <View style={{ alignItems: "center", marginTop: -32 }}>
        <Animated.View
          style={{
            opacity: mark,
            transform: [
              {
                scale: mark.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.94, 1],
                }),
              },
              {
                translateY: mark.interpolate({
                  inputRange: [0, 1],
                  outputRange: [6, 0],
                }),
              },
            ],
          }}
        >
          <Image
            source={require("@/assets/brand/kampusone-symbol-gradient.png")}
            resizeMode="contain"
            style={{ width: 116, height: 93 }}
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
          <Text
            style={{
              color: theme.text,
              fontFamily: theme.font.displayStrong,
              fontSize: 31,
              letterSpacing: -0.7,
            }}
          >
            KampusOne
          </Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}
