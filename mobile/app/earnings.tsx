import * as Crypto from "expo-crypto";
import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AppState, Linking, Pressable, Text, View } from "react-native";
import {
  ToolPage,
  ToolButton,
  ToolField,
  ToolRow,
} from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { useCapabilities } from "@/src/components/agent-shortcuts";
import { api, ApiError } from "@/src/lib/api";
import { useAuth } from "@/src/auth/auth-context";
type Balance = {
  pending_kobo: number;
  available_kobo: number;
  reserved_kobo: number;
  withdrawn_kobo: number;
  commission_due_kobo?: number;
  unpaid_commissions?: number;
  rides_suspended?: boolean;
  cash_collected_kobo?: number;
};
type Earnings = {
  withdrawalsEnabled?: boolean;
  withdrawalMinimums?: { agent_type: string; minimum_withdrawal_kobo: number }[];
  commissionPaymentsEnabled?: boolean;
  riderCommissionCheckout?: {
    reference: string;
    amount_kobo: number;
    status: string;
  } | null;
  riderCommissionDebts?: {
    rider_profile_id: string;
    university_id: string;
    university_name: string;
    amount_kobo: number;
  }[];
  tutorials: Balance;
  store: Balance;
  deliveries: Balance;
  payoutRequests: {
    id: string;
    amount_kobo: number;
    status: string;
    requested_at: string;
    financial_version?: string | null;
    bank_net_kobo?: number;
    returned_to_wallet?: boolean;
  }[];
};
const money = (v: unknown) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    Number(v ?? 0) / 100,
  );
type PayoutQuote = {
  id: string;
  amountKobo: number;
  walletDebitKobo: number;
  bankNetKobo: number;
  transferFeeAllowanceKobo: number;
  expectedTransferFeeKobo: number;
  expectedStatutoryDutyKobo: number;
  minimumWithdrawalKobo: number;
  feeBearer: "PLATFORM" | "PAYEE";
  bankName: string;
  accountLast4: string;
  expiresAt: string;
};
export default function EarningsScreen() {
  const { user } = useAuth();
  return <AccountEarnings key={user?.id ?? "anonymous"} />;
}
function AccountEarnings() {
  const { theme } = useAppearance();
  const toast = useToast();
  const caps = useCapabilities();
  const [data, setData] = useState<Earnings | null>(null);
  const [selected, setSelected] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [commissionReference, setCommissionReference] = useState("");
  const repaymentRequest = useRef({ profileId: "", id: "" });
  const [fee, setFee] = useState<(PayoutQuote & { requestId: string }) | null>(null);
  const profile =
    caps.profiles.find((p) => p.id === selected) ?? caps.profiles[0];
  const balance =
    profile?.agent_type === "VENDOR"
      ? data?.store
      : profile?.agent_type === "TUTOR"
        ? data?.tutorials
        : data?.deliveries;
  const minimumWithdrawalKobo = data?.withdrawalMinimums?.find((policy) => policy.agent_type === profile?.agent_type)?.minimum_withdrawal_kobo;
  const load = useCallback(async () => {
    const next = await api<Earnings>("/v1/agents/earnings");
    setData(next);
    setLoadError("");
    if (next.riderCommissionCheckout?.reference)
      setCommissionReference(next.riderCommissionCheckout.reference);
  }, []);
  useFocusEffect(
    useCallback(() => {
      const refresh = () => void load().catch((e) => setLoadError(e.message));
      refresh();
      const listener = AppState.addEventListener("change", (state) => {
        if (state === "active") refresh();
      });
      return () => listener.remove();
    }, [load]),
  );
  async function payCommission(profileId = profile?.id) {
    if (!profileId) return;
    setBusy(true);
    try {
      if (repaymentRequest.current.profileId !== profileId)
        repaymentRequest.current = {
          profileId: profileId,
          id: Crypto.randomUUID(),
        };
      const checkout = await api<{
        status?: string;
        reference: string;
        authorizationUrl?: string;
      }>("/v1/agents/rider-commission-checkout", {
        method: "POST",
        body: JSON.stringify({
          agentProfileId: profileId,
          requestId: repaymentRequest.current.id,
        }),
      });
      setCommissionReference(checkout.reference);
      if (checkout.status === "PAID") {
        await load();
        repaymentRequest.current = { profileId: "", id: "" };
        toast("Commission payment confirmed", "success");
      } else if (checkout.status === "REQUIRES_REVIEW")
        toast(
          "Your payment was received and needs finance review. Check payment for its latest status.",
          "info",
        );
      else if (checkout.authorizationUrl)
        await Linking.openURL(checkout.authorizationUrl);
    } catch (e) {
      if (e instanceof ApiError && e.code === "CONFLICT")
        repaymentRequest.current = { profileId: "", id: "" };
      toast(
        e instanceof Error ? e.message : "Commission checkout could not open",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  async function checkCommission() {
    setBusy(true);
    try {
      const result = await api<{ payment: { status: string } }>(
        `/v1/agents/rider-commission-checkout/${encodeURIComponent(commissionReference)}`,
      );
      await load();
      if (result.payment.status === "PAID") {
        repaymentRequest.current = { profileId: "", id: "" };
        setCommissionReference("");
        toast("Commission payment confirmed", "success");
      } else if (result.payment.status === "REQUIRES_REVIEW")
        toast(
          "Your payment was received and needs finance review before commission debt can be cleared.",
          "info",
        );
      else
        toast(
          "Your payment is still pending. You can check again later.",
          "info",
        );
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Payment could not be checked",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  async function reviewWithdrawal() {
    if (!profile) return;
    setBusy(true);
    try {
      const r = await api<{
        quote: PayoutQuote;
      }>("/v1/agents/payout-quote", {
        method: "POST",
        body: JSON.stringify({
          agentProfileId: profile.id,
          amountKobo: Math.round(Number(amount) * 100),
        }),
      });
      setFee({ ...r.quote, requestId: Crypto.randomUUID() });
      setConfirm(true);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Fee quote unavailable", "error");
    } finally {
      setBusy(false);
    }
  }
  async function withdraw() {
    if (!profile || !fee) return;
    setBusy(true);
    try {
      await api("/v1/agents/payouts", {
        method: "POST",
        body: JSON.stringify({
          agentProfileId: profile.id,
          quoteId: fee.id,
          requestId: fee.requestId,
          amountKobo: fee.amountKobo,
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
      {loadError ? (
        <View>
          <Text accessibilityRole="alert" style={{ color: theme.error }}>
            {loadError}
          </Text>
          <ToolButton
            secondary
            label="Try again"
            onPress={() => void load().catch((e) => setLoadError(e.message))}
          />
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {caps.profiles.map((p) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: profile?.id === p.id }}
            key={p.id}
            onPress={() => {
              setSelected(p.id);
              setConfirm(false);
              setFee(null);
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
          {profile?.agent_type === "RIDER" &&
          Number(balance?.available_kobo) < 0
            ? "Commission balance"
            : "Available earnings"}
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
      {profile?.agent_type === "RIDER" &&
      balance?.cash_collected_kobo !== undefined ? (
        <ToolRow
          title="Cash collected on rides"
          detail={money(balance.cash_collected_kobo)}
        />
      ) : null}
      {profile?.agent_type === "RIDER" &&
      Number(balance?.commission_due_kobo) > 0 ? (
        <View
          style={{
            paddingVertical: 20,
            borderTopWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Text
            style={{
              fontFamily: theme.font.bold,
              color: theme.text,
              fontSize: 18,
            }}
          >
            Ride commission · {money(balance?.commission_due_kobo)}
          </Text>
          <Text style={{ color: theme.textMuted, marginVertical: 10 }}>
            {balance?.unpaid_commissions} unpaid ride commission
            {balance?.unpaid_commissions === 1 ? "" : "s"}.{" "}
            {balance?.rides_suspended
              ? "Pay your commission to accept another ride."
              : "New rides pause at four unpaid commissions."}{" "}
            Cash you collected is already with you. Available in-app earnings
            clear commission first.
          </Text>
          <ToolButton
            label={busy ? "Please wait…" : "Pay your commission"}
            disabled={busy || !data?.commissionPaymentsEnabled}
            onPress={() => void payCommission()}
          />
          {commissionReference ? (
            <ToolButton
              secondary
              label="Check payment"
              disabled={busy}
              onPress={() => void checkCommission()}
            />
          ) : null}
        </View>
      ) : null}
      {data?.riderCommissionDebts
        ?.filter((d) => d.rider_profile_id !== profile?.id)
        .map((debt) => (
          <View key={debt.rider_profile_id} style={{ paddingVertical: 16 }}>
            <Text style={{ color: theme.text }}>
              Ride commissions · {debt.university_name} ·{" "}
              {money(debt.amount_kobo)}
            </Text>
            <ToolButton
              label="Pay your commission"
              disabled={busy || !data.commissionPaymentsEnabled}
              onPress={() => void payCommission(debt.rider_profile_id)}
            />
          </View>
        ))}
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
            setFee(null);
          }}
          keyboardType="decimal-pad"
        />
        {data && !data.withdrawalsEnabled && (
          <Text style={{ color: theme.textMuted, marginBottom: 12 }}>
            Withdrawals are not available yet. Your recorded earnings remain
            visible here.
          </Text>
        )}
        <Text
          style={{ color: theme.textMuted, fontSize: 12, marginBottom: 12 }}
        >
          {minimumWithdrawalKobo == null ? "Withdrawal policy is awaiting approval" : `Minimum withdrawal · ${money(minimumWithdrawalKobo)}`}
        </Text>
        {confirm ? (
          <>
            <Text style={{ color: theme.text, marginVertical: 12 }}>
              Wallet debit {money(fee?.walletDebitKobo)}. Transfer to {fee?.bankName} ·••{fee?.accountLast4}: {money(fee?.bankNetKobo)}.
              {"\n"}Transfer fee allowance deducted: {money(fee?.transferFeeAllowanceKobo)}. {fee?.feeBearer === "PLATFORM" ? "KampusOne absorbs the transfer fee." : "Any unused transfer fee allowance returns to your wallet after verification."}
              {"\n"}Expected statutory duty: {money(fee?.expectedStatutoryDutyKobo)}, absorbed by KampusOne and reconciled separately. Any receiving-bank deduction is unverified.
            </Text>
            <ToolButton
              label={`Confirm ${money(fee?.walletDebitKobo)} withdrawal`}
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
              !data?.withdrawalsEnabled ||
              minimumWithdrawalKobo == null ||
              Number(amount) * 100 < Number(minimumWithdrawalKobo) ||
              !Number.isFinite(Number(amount)) ||
              Number(amount) * 100 > Number(balance?.available_kobo ?? 0)
            }
            onPress={() => void reviewWithdrawal()}
          />
        )}
      </View>
      {data?.payoutRequests.map((p) => (
        <View key={p.id}>
          <ToolRow
            title={money(p.amount_kobo)}
            detail={
              (p.returned_to_wallet ? 'Returned to wallet' : p.status.replaceAll("_", " ")) +
              " · " +
              new Date(p.requested_at).toLocaleDateString()
            }
          />
          {p.financial_version === "LEDGER_PAYOUT_V1" ? (
            <>
              <Text style={{ color: theme.textMuted }}>
                Quoted bank amount · {money(p.bank_net_kobo)}
              </Text>
              <ToolButton
                secondary
                label="Check withdrawal"
                disabled={busy}
                onPress={() => {
                  setBusy(true);
                  void api<{ payout: { status: string;returned_to_wallet?:boolean } }>(
                    `/v1/agents/payouts/${p.id}`,
                  )
                    .then(async (r) => {
                      await load();
                      toast(
                        r.payout.returned_to_wallet ? 'Your withdrawal was returned to your available wallet.' : `Withdrawal · ${r.payout.status.toLowerCase().replaceAll("_", " ")}`,
                        "info",
                      );
                    })
                    .catch((e) => toast(e.message, "error"))
                    .finally(() => setBusy(false));
                }}
              />
            </>
          ) : null}
        </View>
      ))}
    </ToolPage>
  );
}
