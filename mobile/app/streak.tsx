import { useEffect, useState } from "react";
import { Share, Text, View } from "react-native";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { StreakCard } from "@/src/components/visual-system";
type Streak = { current_days: number; longest_days: number; goal_days: number };
export default function StreakScreen() {
  const { theme } = useAppearance();
  const toast = useToast();
  const [s, setS] = useState<Streak | null>(null);
  const [goal, setGoal] = useState("7");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{ streak: Streak }>("/v1/account/streak", { method: "POST" })
      .then((r) => {
        setS(r.streak);
        setGoal(String(r.streak.goal_days));
      })
      .catch((e) => toast(e.message, "error"));
  }, [toast]);
  async function save() {
    setBusy(true);
    try {
      await api("/v1/account/streak", {
        method: "PATCH",
        body: JSON.stringify({ goalDays: Number(goal) }),
      });
      toast("Goal saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save goal", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage title="Your streak">
      <View style={{ alignItems: "center", paddingVertical: 32 }}>
        <Text
          style={{
            fontFamily: theme.font.displayStrong,
            fontSize: 76,
            color: theme.brand,
          }}
        >
          {s?.current_days ?? "—"}
        </Text>
        <Text
          style={{
            color: theme.textMuted,
            fontFamily: theme.font.medium,
            marginBottom: 20,
          }}
        >
          days in a row
        </Text>
        {s ? <StreakCard days={s.current_days} /> : null}
        <Text style={{ color: theme.textMuted, marginTop: 18 }}>
          Personal best · {s?.longest_days ?? "—"} days
        </Text>
      </View>
      <ToolField
        label="My goal (days)"
        keyboardType="number-pad"
        value={goal}
        onChangeText={setGoal}
      />
      <ToolButton
        label="Save goal"
        disabled={busy || !s}
        onPress={() => void save()}
      />
      <ToolButton
        secondary
        label="Share my streak"
        disabled={!s}
        onPress={() =>
          void Share.share({
            message: `${s?.current_days} days showing up on KampusOne. My next goal: ${goal} days. 🔥`,
          }).catch(() => toast("Could not open sharing", "error"))
        }
      />
    </ToolPage>
  );
}
