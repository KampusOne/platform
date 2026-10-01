import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { router, useFocusEffect } from "expo-router";
import { ToolPage, ToolButton } from "@/src/components/toolkit";
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
type Plan = {
  amountKobo: number;
  available: boolean;
  checkoutEnabled: boolean;
  currentPeriodEnd: string | null;
  autoRenew: false;
  checkout: { reference: string; status: string; expires_at: string } | null;
};
export default function KiraSubscription() {
  const { user } = useAuth();
  return <AccountSubscription key={user?.id} />;
}
function AccountSubscription() {
  const { theme } = useAppearance(),
    [plan, setPlan] = useState<Plan | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef(randomUUID()),
    alive = useRef(true),
    opening = useRef(false),
    request = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current++;
    };
  }, []);
  const load = useCallback(async () => {
    const turn = ++request.current;
    try {
      const r = await api<{ subscription: Plan }>("/v1/ai/subscription");
      if (alive.current && turn === request.current) {
        setPlan(r.subscription);
        setError("");
      }
    } catch (e) {
      if (alive.current && turn === request.current)
        setError(
          e instanceof Error
            ? e.message
            : "Your plan could not load. Try again.",
        );
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const check = useCallback(async () => {
    if (!plan?.checkout || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ payment: { status: string } }>(
        "/v1/payments/status/" + encodeURIComponent(plan.checkout.reference),
      );
      if (!alive.current) return;
      setNotice(
        r.payment.status === "SUCCEEDED"
          ? "Payment confirmed. Your Kira Pro month is active."
          : r.payment.status === "REQUIRES_REVIEW"
            ? "Your payment is recorded and awaiting support review. Please keep its reference."
            : "Payment is still awaiting confirmation. Check again after completing checkout.",
      );
      await load();
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "Confirmation is unavailable. Your payment reference is saved.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [plan, busy, load]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && opening.current) {
        opening.current = false;
        void load();
      }
    });
    return () => sub.remove();
  }, [load]);
  async function pay() {
    if (busy || !plan?.checkoutEnabled) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{
        authorizationUrl: string;
        reference: string;
        amountKobo: number;
      }>("/v1/ai/subscription-checkout", {
        method: "POST",
        body: JSON.stringify({ requestId: key.current, consent: true }),
      });
      if (!alive.current) return;
      if (result.amountKobo !== 600000)
        throw new Error(
          "The checkout total did not match the displayed plan. Refresh before paying.",
        );
      await load();
      opening.current = true;
      await Linking.openURL(result.authorizationUrl);
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "Checkout could not open. Your payment status can be checked safely.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <ToolPage title="Kira Pro">
      <View style={{ gap: 12, paddingVertical: 16 }}>
        <Text
          style={{
            fontFamily: theme.font.display,
            fontSize: 36,
            color: theme.text,
          }}
        >
          ₦6,000{" "}
          <Text
            style={{
              fontSize: 16,
              fontFamily: theme.font.body,
              color: theme.textMuted,
            }}
          >
            per month
          </Text>
        </Text>
        <Text
          style={{
            fontFamily: theme.font.body,
            color: theme.text,
            lineHeight: 23,
          }}
        >
          More room for studying, summaries and notes. The amount shown here is
          your complete plan price.
        </Text>
        <Text
          style={{
            fontFamily: theme.font.body,
            color: theme.textMuted,
            lineHeight: 22,
          }}
        >
          One month at a time. No automatic renewal. Your access starts after
          payment is verified; an eligible renewal extends your current paid
          period.
        </Text>
        {plan?.currentPeriodEnd ? (
          <Text
            accessibilityRole="text"
            style={{ fontFamily: theme.font.semibold, color: theme.brand }}
          >
            Pro active until{" "}
            {new Date(plan.currentPeriodEnd).toLocaleDateString("en-NG", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </Text>
        ) : null}
        {!plan && !error ? (
          <Text style={{ color: theme.textMuted }}>Loading your plan…</Text>
        ) : null}
        {plan && !plan.available ? (
          <Text style={{ color: theme.textMuted }}>
            Monthly checkout will open after payment setup is approved.
          </Text>
        ) : null}
        {plan?.currentPeriodEnd && !plan.checkoutEnabled ? (
          <Text style={{ color: theme.textMuted }}>
            Renewal opens during your final seven days when checkout is
            available.
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={{ color: theme.error }}>
            {error}
          </Text>
        ) : null}
        {notice ? (
          <Text accessibilityRole="text" style={{ color: theme.text }}>
            {notice}
          </Text>
        ) : null}
        <ToolButton
          label={
            busy
              ? "Please wait…"
              : plan?.checkout?.status === "INITIALIZED"
                ? "Resume ₦6,000 checkout"
                : plan?.currentPeriodEnd
                  ? "Renew for ₦6,000"
                  : "Get one month · ₦6,000"
          }
          disabled={
            busy ||
            !plan?.checkoutEnabled ||
            plan?.checkout?.status === "REQUIRES_REVIEW"
          }
          onPress={() => void pay()}
        />
        {plan?.checkout ? (
          <>
            <Text style={{ color: theme.textMuted, fontSize: 12 }}>
              Payment reference: {plan.checkout.reference}
            </Text>
            <ToolButton
              secondary
              label="Check payment"
              disabled={busy}
              onPress={() => void check()}
            />
          </>
        ) : null}
        <ToolButton
          secondary
          label="Refresh plan"
          disabled={busy}
          onPress={() => void load()}
        />
        <ToolButton
          secondary
          label="Open Kira"
          disabled={busy}
          onPress={() => router.replace("/ai")}
        />
      </View>
    </ToolPage>
  );
}
