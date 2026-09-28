import { useSyncExternalStore } from "react";
import { Platform, Text, type StyleProp, type TextStyle } from "react-native";
import { feedTime } from "@/src/lib/feed-time";

// One clock for the whole feed, not one interval per post or reply.
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
function tick() { now = Date.now(); for (const listener of listeners) listener(); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) { now = Date.now(); timer = setInterval(tick, 30_000); }
  return () => { listeners.delete(listener); if (!listeners.size && timer) { clearInterval(timer); timer = undefined; } };
}
const snapshot = () => now;
const serverSnapshot = () => 0;
export function RelativeTime({ value, style }: { value: string; style?: StyleProp<TextStyle> }) {
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  // Web SSR keeps the stable placeholder until hydration. Native has no SSR, so
  // never allow that placeholder snapshot to become the permanent APK value.
  const effectiveNow = current || (Platform.OS === "web" ? 0 : Date.now());
  const formatted = effectiveNow ? feedTime(value, effectiveNow) : { text: "Recently", label: "Publication time", exact: "" };
  return <Text accessibilityLabel={`${formatted.label}${formatted.exact ? `. ${formatted.exact}` : ""}`} style={style}>{formatted.text}</Text>;
}
