import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const REFRESH_TOKEN_KEY = "kampusone.refresh-token.v1";

export async function readRefreshToken() {
  if (Platform.OS === "web" || !await SecureStore.isAvailableAsync()) return null;
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function saveRefreshToken(token: string) {
  if (Platform.OS === "web") return;
  if (!await SecureStore.isAvailableAsync()) {
    throw new Error("Secure device storage is unavailable.");
  }
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function removeRefreshToken() {
  if (Platform.OS === "web" || !await SecureStore.isAvailableAsync()) return;
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}
