import * as NativeHaptics from "expo-haptics";
import { getPreferences } from "./preferences";
export const ImpactFeedbackStyle = NativeHaptics.ImpactFeedbackStyle;
export const NotificationFeedbackType = NativeHaptics.NotificationFeedbackType;
export async function selectionAsync() {
  if (getPreferences().haptics) await NativeHaptics.selectionAsync();
}
export async function impactAsync(style?: NativeHaptics.ImpactFeedbackStyle) {
  if (getPreferences().haptics) await NativeHaptics.impactAsync(style);
}
export async function notificationAsync(
  style?: NativeHaptics.NotificationFeedbackType,
) {
  if (getPreferences().haptics) await NativeHaptics.notificationAsync(style);
}
