import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "@/src/theme";

export function SectionHeading({
  title,
  meta,
  onPress,
}: {
  title: string;
  meta?: string;
  onPress?: () => void;
}) {
  const { theme, styles } = useThemeStyles(createStyles);

  return (
    <View style={styles.row}>
      <Text
        android_hyphenationFrequency="none"
        style={styles.title}
        textBreakStrategy="simple"
      >
        {title}
      </Text>
      {meta ? (
        <Pressable
          accessibilityRole={onPress ? "button" : undefined}
          disabled={!onPress}
          hitSlop={8}
          onPress={onPress}
          style={({ pressed }) => [styles.metaWrap, pressed && styles.pressed]}
        >
          <Text
            android_hyphenationFrequency="none"
            style={styles.meta}
            textBreakStrategy="simple"
          >
            {meta}
          </Text>
          {onPress ? (
            <Ionicons
              name="chevron-forward"
              size={16}
              color={theme.brandPressed}
            />
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      alignItems: "baseline",
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: theme.spacing[3],
      minWidth: 0,
    },
    title: {
      color: theme.text,
      fontFamily: theme.font.display,
      fontSize: 19,
      flex: 1,
      letterSpacing: -0.2,
      minWidth: 0,
      paddingRight: 12,
    },
    meta: {
      color: theme.brandPressed,
      fontFamily: theme.font.semibold,
      fontSize: 13,
    },
    metaWrap: {
      alignItems: "center",
      flexDirection: "row",
      flexShrink: 0,
      gap: 3,
    },
    pressed: { opacity: 0.58 },
  });
const styles = createStyles(theme);
