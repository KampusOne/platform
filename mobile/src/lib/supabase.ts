import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export const isSupabaseConfigured =
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl) &&
  supabasePublishableKey.length > 20 &&
  !supabasePublishableKey.includes("replace_me");

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        detectSessionInUrl: Platform.OS === "web",
        persistSession: true,
      },
    })
  : null;

if (supabase && Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

export function readableAuthError(error: unknown) {
  if (error instanceof Error) {
    if (/invalid login credentials/i.test(error.message)) {
      return "That email and password do not match. Check them and try again.";
    }
    if (/email not confirmed/i.test(error.message)) {
      return "Confirm your email first, then come back to sign in.";
    }
    return error.message;
  }
  return "We could not complete that request. Please try again.";
}
