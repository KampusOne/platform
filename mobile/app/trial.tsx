import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { ToolPage, ToolButton } from "@/src/components/toolkit";
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
  useEffect(() => {
    void api<{ trial: Trial | null }>("/v1/applications/trial")
      .then((r) => {
        setTrial(r.trial);
        setReady(true);
      })
      .catch((e) => toast(e.message, "error"));
  }, [toast]);
  async function claim() {
    setBusy(true);
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
      toast(e instanceof Error ? e.message : "Could not claim trial", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage title="Your free trial">
      <View style={{ paddingVertical: 32 }}>
        <Text
          style={{
            fontFamily: theme.font.displayStrong,
            fontSize: 42,
            color: theme.text,
          }}
        >
          10 months
        </Text>
        <Text
          style={{
            fontFamily: theme.font.body,
            color: theme.textMuted,
            lineHeight: 24,
            marginTop: 12,
          }}
        >
          No subscription charge. Transaction commissions still apply.
        </Text>
      </View>
      {trial ? (
        <>
          <Text style={{ color: theme.text, fontFamily: theme.font.medium }}>
            {trial.revoked_at
              ? "Trial revoked"
              : new Date(trial.expires_at).getTime() < Date.now()
                ? "Trial ended"
                : "Trial active"}
          </Text>
          <Text style={{ color: theme.textMuted, marginTop: 12 }}>
            Ends {new Date(trial.expires_at).toLocaleDateString()}
          </Text>
        </>
      ) : (
        <ToolButton
          label="Claim free trial"
          disabled={!ready || busy}
          onPress={() => void claim()}
        />
      )}
    </ToolPage>
  );
}
