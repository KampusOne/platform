import { useEffect, useState } from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";
import {
  clearPendingSharedTarget,
  rememberSharedTarget,
} from "@/src/lib/entry-preferences";
import { sharedDestination, type ShareKind } from "@/src/lib/shared-links";
export default function SharedEntry() {
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>(),
    { state, profile, profileState } = useAuth(),
    { theme } = useAppearance();
  const destination = sharedDestination(kind, id),
    [saved, setSaved] = useState("");
  const needsEntry =
    state === "anonymous" ||
    (state === "authenticated" &&
      (profileState === "error" || !profile?.onboarding_completed_at));
  useEffect(() => {
    if (!destination || !needsEntry) return;
    let live = true;
    void rememberSharedTarget(kind as ShareKind, id).finally(() => {
      if (live) setSaved(`${kind}:${id}`);
    });
    return () => {
      live = false;
    };
  }, [kind, id, needsEntry]);
  useEffect(() => {
    if (
      destination &&
      state === "authenticated" &&
      profile?.onboarding_completed_at
    )
      clearPendingSharedTarget();
  }, [kind, id, state, profile?.onboarding_completed_at]);
  if (!destination)
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          padding: 30,
          backgroundColor: theme.canvas,
        }}
      >
        <Text style={{ color: theme.text, fontFamily: theme.font.body }}>
          This KampusOne link is not valid.
        </Text>
      </View>
    );
  if (
    state === "loading" ||
    (state === "authenticated" && profileState === "loading")
  )
    return null;
  if (needsEntry)
    return saved === `${kind}:${id}` ? <Redirect href="/" /> : null;
  return <Redirect href={destination} />;
}
