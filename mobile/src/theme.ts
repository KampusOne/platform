import { nativeTheme, radius, spacing } from "@kampusone/design-tokens/native";

export const theme = {
  ...nativeTheme,
  radius,
  spacing,
  shadow: {
    shadowColor: "#29231F",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 3,
  },
} as const;
