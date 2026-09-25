import { useEffect, useRef } from "react";
import { Animated, Pressable } from "react-native";
import { useAppearance } from "@/src/lib/appearance";
import { selectionAsync } from "@/src/lib/haptics";
import { useReducedMotionPreference } from "./product-ui";

export function BrandSwitch({
  value,
  onValueChange,
  label,
  disabled = false,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const { theme } = useAppearance();
  const reducedMotion = useReducedMotionPreference();
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    const animation = Animated.timing(position, {
      toValue: value ? 1 : 0,
      duration: reducedMotion ? 0 : 160,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [position, value, reducedMotion]);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={(event) => {
        event.stopPropagation();
        void selectionAsync().catch(() => undefined);
        onValueChange(!value);
      }}
      style={{
        minHeight: 44,
        minWidth: 52,
        justifyContent: "center",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Animated.View
        style={{
          width: 48,
          height: 28,
          borderRadius: 14,
          backgroundColor: value ? theme.deepBrand : theme.surfaceMuted,
          borderWidth: 1,
          borderColor: value ? theme.deepBrand : theme.border,
          justifyContent: "center",
          paddingHorizontal: 3,
        }}
      >
        <Animated.View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: value ? "#FFFFFF" : theme.textMuted,
            transform: [
              {
                translateX: position.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 20],
                }),
              },
            ],
          }}
        />
      </Animated.View>
    </Pressable>
  );
}
