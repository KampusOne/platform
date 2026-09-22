import { useSyncExternalStore } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
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
  const formatted = current ? feedTime(value, current) : { text: "Recently", label: "Publication time", exact: "" };
  return <Text accessibilityLabel={`${formatted.label}${formatted.exact ? `. ${formatted.exact}` : ""}`} style={style}>{formatted.text}</Text>;
}
