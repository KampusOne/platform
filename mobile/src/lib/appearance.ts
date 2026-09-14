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
  canvas: "#191614",
  surface: "#25211E",
  surfaceMuted: "#302923",
  surfaceSoft: "#302923",
  surfaceRaised: "#29231F",
  surfaceGlass: "rgba(37,33,30,0.88)",
  surfaceGlassStrong: "rgba(37,33,30,0.96)",
  surfaceTint: "rgba(233,177,142,0.10)",
  text: "#FAF1E8",
  textMuted: "#C0AFA2",
  textSubtle: "#C0AFA2",
  textFaint: "#9A8D84",
  border: "rgba(241,223,200,0.15)",
  deepBrand: "#A8462E",
  brand: "#E99C76",
  brandPressed: "#DE8661",
  sand: "#47362A",
  success: "#91BD95",
  warning: "#E1BA67",
  error: "#F29A83",
  info: "#89B3C1",
  warmWhite: "#25211E",
};
let preference: AppearancePreference = "system";
const listeners = new Set<() => void>();
let initialized = false;
export async function initializeAppearance() {
  if (initialized) return;
  initialized = true;
  try {
    const saved = await AsyncStorage.getItem("k1.appearance");
    if (saved === "dark" || saved === "light") {
      preference = saved;
      listeners.forEach((fn) => fn());
    }
  } catch {
    /* Follow system if storage is unavailable. */
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
