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
  surface: "#0D0D0D",
  surfaceMuted: "#171717",
  surfaceSoft: "#171717",
  surfaceRaised: "#111111",
  surfaceGlass: "rgba(13,13,13,0.88)",
  surfaceGlassStrong: "rgba(13,13,13,0.96)",
  surfaceTint: "rgba(195,93,56,0.13)",
  text: "#FFFFFF",
  textMuted: "#B7B1AD",
  textSubtle: "#A39C97",
  textFaint: "#807A76",
  border: "rgba(255,255,255,0.12)",
  deepBrand: "#C35D38",
  brand: "#D9855F",
  brandPressed: "#C35D38",
  sand: "#211814",
  peach: "#D9855F",
  clay: "#C35D38",
  success: "#7FB488",
  warning: "#E2B866",
  error: "#F08C78",
  info: "#8AB4C2",
  warmWhite: "#0D0D0D",
  midnight: "#000000",
  shadow: {
    ...light.shadow,
    shadowColor: "#000000",
    shadowOpacity: 0.4,
  },
  floatingShadow: {
    ...light.floatingShadow,
    shadowColor: "#000000",
    shadowOpacity: 0.55,
  },
  glassShadow: {
    ...light.glassShadow,
    shadowColor: "#000000",
    shadowOpacity: 0.5,
  },
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
