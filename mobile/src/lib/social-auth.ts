import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { api, authApi, type Session } from "./api";
const key = "k1.oauth.pkce";
export type SocialProvider = "google" | "apple";
export function socialConfiguration() {
  return api<{ url: string; providers: SocialProvider[] }>(
    "/v1/auth/social/config",
    {},
    false,
  );
}
async function save(value: string) {
  if (Platform.OS === "web") sessionStorage.setItem(key, value);
  else await SecureStore.setItemAsync(key, value);
}
async function take() {
  const value =
    Platform.OS === "web"
      ? sessionStorage.getItem(key)
      : await SecureStore.getItemAsync(key);
  if (Platform.OS === "web") sessionStorage.removeItem(key);
  else await SecureStore.deleteItemAsync(key);
  return value;
}
let pending: Promise<Session> | null = null;
export async function finishSocialSignIn(url: string) {
  if (pending) return pending;
  pending = (async () => {
    const callback = new URL(url);
    const params = callback.searchParams;
    if (
      params.get("error") ||
      new URLSearchParams(callback.hash.slice(1)).get("error")
    ) {
      await take();
      throw new Error("Sign-in was cancelled or declined.");
    }
    const code = params.get("code");
    if (!code) throw new Error("The sign-in link is incomplete.");
    const saved = await take();
    if (!saved) throw new Error("Start sign-in again on this device.");
    let state: { verifier: string; expires: number };
    try {
      state = JSON.parse(saved);
    } catch {
      throw new Error("Start sign-in again on this device.");
    }
    if (
      !state ||
      typeof state.expires !== "number" ||
      typeof state.verifier !== "string" ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(state.verifier) ||
      state.expires < Date.now()
    )
      throw new Error("This sign-in attempt expired.");
    return authApi.socialComplete(code, state.verifier);
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}
export async function beginSocialSignIn(provider: "google" | "apple") {
  const { url: base, providers } = await socialConfiguration();
  if (!providers.includes(provider)) {
    throw new Error(
      `${provider === "google" ? "Google" : "Apple"} sign-in is unavailable. Continue with your email.`,
    );
  }
  const redirect =
    Platform.OS === "web"
      ? window.location.origin + "/auth-callback"
      : "kampusone://auth-callback";
  const verifier =
    Crypto.randomUUID().replaceAll("-", "") +
    Crypto.randomUUID().replaceAll("-", "");
  const challenge = (
    await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      verifier,
      { encoding: Crypto.CryptoEncoding.BASE64 },
    )
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  await save(JSON.stringify({ verifier, expires: Date.now() + 10 * 60000 }));
  const target = new URL("/auth/v1/authorize", base);
  target.searchParams.set("provider", provider);
  target.searchParams.set("redirect_to", redirect);
  target.searchParams.set("code_challenge", challenge);
  target.searchParams.set("code_challenge_method", "s256");
  if (Platform.OS === "web") {
    window.location.assign(target.toString());
    return null;
  }
  const response = await WebBrowser.openAuthSessionAsync(
    target.toString(),
    redirect,
  );
  if (response.type !== "success") {
    await take();
    return null;
  }
  return finishSocialSignIn(response.url);
}
