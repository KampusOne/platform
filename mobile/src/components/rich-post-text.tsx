import { router } from "expo-router";
import { Linking, Text, type TextProps } from "react-native";
import { useAppearance } from "@/src/lib/appearance";

const tokenPattern = /((?:https?:\/\/|www\.)[^\s]+|#[\p{L}\p{N}_]+)/giu;

function linkParts(raw: string) {
  const cleaned = raw.replace(/[),.!?;:]+$/u, "");
  return {
    display: cleaned,
    href: cleaned.startsWith("www.") ? `https://${cleaned}` : cleaned,
    suffix: raw.slice(cleaned.length),
  };
}

export function RichPostText({
  children,
  ...props
}: Omit<TextProps, "children"> & { children: string }) {
  const { theme } = useAppearance();
  const parts = children.split(tokenPattern);

  return (
    <Text {...props}>
      {parts.map((part, index) => {
        if (!part) return null;

        if (part.startsWith("#")) {
          return (
            <Text
              accessibilityRole="link"
              key={index}
              onPress={(event) => {
                event.stopPropagation();
                router.push({
                  pathname: "/(tabs)/feed",
                  params: { q: part },
                } as never);
              }}
              style={{ color: theme.deepBrand, fontFamily: theme.font.medium }}
            >
              {part}
            </Text>
          );
        }

        if (/^(?:https?:\/\/|www\.)/iu.test(part)) {
          const { display, href, suffix } = linkParts(part);
          return (
            <Text key={index}>
              <Text
                accessibilityRole="link"
                onPress={(event) => {
                  event.stopPropagation();
                  void Linking.openURL(href);
                }}
                style={{
                  color: theme.deepBrand,
                  textDecorationLine: "underline",
                }}
              >
                {display}
              </Text>
              {suffix}
            </Text>
          );
        }

        return part;
      })}
    </Text>
  );
}
