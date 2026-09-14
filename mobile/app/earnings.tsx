import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Pressable, Text, View } from "react-native";
import {
  ToolPage,
  ToolButton,
  ToolField,
  ToolRow,
} from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { useCapabilities } from "@/src/components/agent-shortcuts";
import { api } from "@/src/lib/api";
type Balance = {
  pending_kobo: number;
  available_kobo: number;
  reserved_kobo: number;
  withdrawn_kobo: number;
};
type Earnings = {
  tutorials: Balance;
  store: Balance;
  deliveries: Balance;
  payoutRequests: {
    id: string;
    amount_kobo: number;
    status: string;
    requested_at: string;
  }[];
};
const money = (v: unknown) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    Number(v ?? 0) / 100,
  );
export default function EarningsScreen() {
  const { theme } = useAppearance();
  const toast = useToast();
  const caps = useCapabilities();
  const [data, setData] = useState<Earnings | null>(null);
  const [selected, setSelected] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const profile =
    caps.profiles.find((p) => p.id === selected) ?? caps.profiles[0];
  const balance =
    profile?.agent_type === "VENDOR"
      ? data?.store
      : profile?.agent_type === "TUTOR"
        ? data?.tutorials
        : data?.deliveries;
  const load = useCallback(
    async () => setData(await api<Earnings>("/v1/agents/earnings")),
    [],
  );
  useFocusEffect(
    useCallback(() => {
      void load().catch((e) => toast(e.message, "error"));
    }, [load, toast]),
  );
  async function withdraw() {
    if (!profile) return;
    setBusy(true);
    try {
      await api("/v1/agents/payouts", {
        method: "POST",
        body: JSON.stringify({
          agentProfileId: profile.id,
          amountKobo: Math.round(Number(amount) * 100),
        }),
      });
      setConfirm(false);
      setAmount("");
      await load();
      toast("Withdrawal requested", "success");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Could not request payout",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage title="Earnings">
      <View style={{ flexDirection: "row", gap: 8 }}>
        {caps.profiles.map((p) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: profile?.id === p.id }}
            key={p.id}
            onPress={() => {
              setSelected(p.id);
              setConfirm(false);
            }}
            style={{
              padding: 12,
              borderRadius: 12,
              backgroundColor:
                profile?.id === p.id ? theme.sand : theme.surface,
            }}
          >
            <Text style={{ color: theme.text }}>
              {p.agent_type.toLowerCase()}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={{ paddingVertical: 30 }}>
        <Text style={{ color: theme.textMuted, fontFamily: theme.font.medium }}>
          Available earnings
        </Text>
        <Text
          style={{
            fontFamily: theme.font.displayStrong,
            color: theme.text,
            fontSize: 38,
            marginTop: 10,
          }}
        >
          {data ? money(balance?.available_kobo) : "—"}
        </Text>
      </View>
      <ToolRow
        title="Pending"
        detail={data ? money(balance?.pending_kobo) : "—"}
      />
      <ToolRow
        title="In withdrawal"
        detail={data ? money(balance?.reserved_kobo) : "—"}
      />
      <ToolRow
        title="Paid out"
        detail={data ? money(balance?.withdrawn_kobo) : "—"}
      />
      <View style={{ marginTop: 24 }}>
        <ToolField
          label="Withdrawal amount (₦)"
          value={amount}
          onChangeText={(v) => {
            setAmount(v);
            setConfirm(false);
          }}
          keyboardType="decimal-pad"
        />
        <Text
          style={{ color: theme.textMuted, fontSize: 12, marginBottom: 12 }}
        >
          Minimum withdrawal · ₦5,000
        </Text>
        {confirm ? (
          <>
            <Text style={{ color: theme.text, marginVertical: 12 }}>
              Request {money(Math.round(Number(amount) * 100))} to your verified
              payout account?
            </Text>
            <ToolButton
              label="Confirm withdrawal"
              disabled={busy}
              onPress={() => void withdraw()}
            />
            <ToolButton
              secondary
              label="Cancel"
              onPress={() => setConfirm(false)}
            />
          </>
        ) : (
          <ToolButton
            label="Request withdrawal"
            disabled={
              busy ||
              !profile ||
              Number(amount) < 5000 ||
              !Number.isFinite(Number(amount)) ||
              Number(amount) * 100 > Number(balance?.available_kobo ?? 0)
            }
            onPress={() => setConfirm(true)}
          />
        )}
      </View>
      {data?.payoutRequests.map((p) => (
        <ToolRow
          key={p.id}
          title={money(p.amount_kobo)}
          detail={
            p.status.replaceAll("_", " ") +
            " · " +
            new Date(p.requested_at).toLocaleDateString()
          }
        />
      ))}
    </ToolPage>
  );
}
