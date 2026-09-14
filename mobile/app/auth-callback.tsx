import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/src/auth/auth-context";
import { finishSocialSignIn } from "@/src/lib/social-auth";
import { ToolButton, ToolPage } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useToast } from "@/src/components/toast";
export default function AuthCallback() {
  const params = useLocalSearchParams<{ code?: string; error?: string }>(),
    { beginSession } = useAuth(),
    toast = useToast();
  const [started] = useState(Date.now()),
    once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const url =
      Platform.OS === "web"
        ? window.location.href
        : "kampusone://auth-callback?" +
          new URLSearchParams(params as Record<string, string>).toString();
    void finishSocialSignIn(url)
      .then(async (session) => {
        await beginSession(session);
        router.replace("/");
      })
      .catch((e) => {
        toast(e.message);
        router.replace("/(auth)/sign-in");
      });
  }, [beginSession, params, started, toast]);
  return (
    <ToolPage title="Signing you in">
      <ScreenSkeleton />
      <ToolButton
        label="Back to sign in"
        secondary
        onPress={() => router.replace("/(auth)/sign-in")}
      />
    </ToolPage>
  );
}
