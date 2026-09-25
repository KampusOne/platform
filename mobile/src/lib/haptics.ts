import * as NativeHaptics from "expo-haptics";
import { Platform } from "react-native";
import { getPreferences } from "./preferences";
export const ImpactFeedbackStyle = NativeHaptics.ImpactFeedbackStyle;
export const NotificationFeedbackType = NativeHaptics.NotificationFeedbackType;
async function feedback(action: () => Promise<void>) {
  if (Platform.OS === "web" || !getPreferences().haptics) return;
  try {
    await action();
  } catch {
    /* Haptic hardware is optional; interaction must still succeed. */
  }
}
export function selectionAsync() {
  return feedback(() => NativeHaptics.selectionAsync());
}
export function impactAsync(style?: NativeHaptics.ImpactFeedbackStyle) {
  return feedback(() => NativeHaptics.impactAsync(style));
}
export function notificationAsync(
  style?: NativeHaptics.NotificationFeedbackType,
) {
  return feedback(() => NativeHaptics.notificationAsync(style));
}
