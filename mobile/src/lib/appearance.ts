import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMemo, useSyncExternalStore } from "react";
import { useColorScheme } from "react-native";
import { theme as light } from "@/src/theme";

export type AppearancePreference = "system" | "light" | "dark";
export type Theme = {
  [K in keyof typeof light]: (typeof light)[K] extends string
    ? string
    : (typeof light)[K];
};
const dark: Theme = {
  ...light,
  canvas: "#000000",
  surface: "#101010",
  surfaceMuted: "#1A1A1A",
  surfaceSoft: "#1A1A1A",
  surfaceRaised: "#202020",
  surfaceGlass: "rgba(16,16,16,0.92)",
  surfaceGlassStrong: "rgba(16,16,16,0.98)",
  surfaceTint: "rgba(233,177,142,0.10)",
  text: "#F5F5F5",
  textMuted: "#BEBEBE",
  textSubtle: "#BEBEBE",
  textFaint: "#999999",
  border: "#303030",
  deepBrand: "#A8462E",
  brand: "#E99C76",
  brandPressed: "#DE8661",
  accentText: "#EEA382",
  sand: "#242424",
  success: "#91BD95",
  warning: "#E1BA67",
  error: "#F29A83",
  info: "#89B3C1",
  warmWhite: "#101010",
  midnight: "#171717",
  statusPositive: "#91BD95",
  statusAttention: "#E1BA67",
  sponsored: "#BEBEBE",
};
let preference: AppearancePreference = "light";
const listeners = new Set<() => void>();
let initialized = false;
export async function initializeAppearance() {
  if (initialized) return;
  initialized = true;
  try {
    const saved = await AsyncStorage.getItem("k1.appearance");
    if (saved === "dark" || saved === "light" || saved === "system") {
      preference = saved;
      listeners.forEach((fn) => fn());
    }
  } catch {
    /* Keep the light default if storage is unavailable. */
  }
}
export async function setAppearance(value: AppearancePreference) {
  preference = value;
  listeners.forEach((fn) => fn());
  await AsyncStorage.setItem("k1.appearance", value);
}
export function useAppearance() {
  const selected = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => preference,
    () => preference,
  );
  const system = useColorScheme();
  const isDark =
    selected === "dark" || (selected === "system" && system === "dark");
  return { preference: selected, isDark, theme: isDark ? dark : light };
}
export function useThemeStyles<T>(factory: (theme: Theme) => T) {
  const state = useAppearance();
  return {
    ...state,
    styles: useMemo(() => factory(state.theme), [factory, state.theme]),
  };
}
