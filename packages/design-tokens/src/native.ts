import { kampusOne } from "./index";

export const colors = kampusOne.color;
export const spacing = kampusOne.space;
export const radius = kampusOne.radius;
export const typography = kampusOne.typography;

export const nativeTheme = {
  canvas: colors.neutral.cream,
  surface: colors.neutral.white,
  surfaceMuted: colors.brand[50],
  text: colors.neutral.ink,
  textMuted: "#6F645D",
  border: "#E6DCD4",
  brand: colors.brand[600],
  brandPressed: colors.brand[700],
  success: colors.semantic.success,
  warning: colors.semantic.warning,
  error: colors.semantic.error,
} as const;
