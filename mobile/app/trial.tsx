import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { ToolPage, ToolButton } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
type Trial = {
  claimed_at: string;
  expires_at: string;
  revoked_at: string | null;
};
export default function FreeTrial() {
  const { theme } = useAppearance();
  const toast = useToast();
  const [trial, setTrial] = useState<Trial | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      setTrial(
        (await api<{ trial: Trial | null }>("/v1/applications/trial")).trial,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your trial could not load.");
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function claim() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setTrial(
        (
          await api<{ trial: Trial }>("/v1/applications/trial", {
            method: "POST",
          })
        ).trial,
      );
      toast("Trial claimed", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not claim trial");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage title="Your seller trial">
      {!ready ? (
        <ScreenSkeleton variant="list" compact />
      ) : (
        <>
          <View style={{ paddingVertical: 24 }}>
            <Text
              style={{
                fontFamily: theme.font.displayStrong,
                fontSize: 38,
                color: theme.text,
              }}
            >
              {trial ? "Your trial" : "12 months"}
            </Text>
            <Text
              style={{
                fontFamily: theme.font.body,
                color: theme.textMuted,
                lineHeight: 24,
                marginTop: 12,
              }}
            >
              {trial
                ? "Your saved entitlement dates are shown below."
                : "For eligible, approved sellers. No subscription charge during your trial. Transaction commissions still apply."}
            </Text>
          </View>
          {error ? (
            <>
              <Text
                accessibilityRole="alert"
                style={{ color: theme.error, lineHeight: 22 }}
              >
                {error}
              </Text>
              <ToolButton
                secondary
                label="Refresh trial status"
                onPress={() => void load()}
              />
            </>
          ) : null}
          {trial ? (
            <>
              <Text
                style={{ color: theme.text, fontFamily: theme.font.medium }}
              >
                {trial.revoked_at
                  ? "Trial revoked"
                  : new Date(trial.expires_at).getTime() < Date.now()
                    ? "Trial ended"
                    : "Trial active"}
              </Text>
              <Text style={{ color: theme.textMuted, marginTop: 12 }}>
                Started {new Date(trial.claimed_at).toLocaleDateString()}
              </Text>
              <Text style={{ color: theme.textMuted, marginTop: 12 }}>
                Ends {new Date(trial.expires_at).toLocaleDateString()}
              </Text>
            </>
          ) : !error ? (
            <ToolButton
              label={busy ? "Claiming trial…" : "Claim seller trial"}
              disabled={!ready || busy}
              onPress={() => void claim()}
            />
          ) : null}
        </>
      )}
    </ToolPage>
  );
}
