import { useCallback, useState } from "react";
import { Linking, Text } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ToolPage, ToolButton } from "@/src/components/toolkit";
import { api } from "@/src/lib/api";
import { useAppearance } from "@/src/lib/appearance";
type Summary = {
  id: string;
  title: string;
  status: string;
  base_kobo: number;
  buyer_fee_kobo: number;
  delivery_fee_kobo: number;
  amount_kobo: number;
  cash_due_kobo?: number;
  discount_kobo?: number;
  total_kobo?: number;
  distance_metres?: number | null;
  campus_zone_estimate?: boolean;
  fee_snapshot?: {
    delivery?: { distanceMetres: number | null; distanceBasis: string };
  };
};
export default function PaymentReview() {
  const { id, type } = useLocalSearchParams<{ id: string; type: string }>(),
    { theme } = useAppearance();
  const [p, setPurchase] = useState<Summary | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await api<{ payment: Summary; checkoutEnabled: boolean }>(
        `/v1/payments/summary?resourceType=${encodeURIComponent(type)}&resourceId=${encodeURIComponent(id)}`,
      );
      setPurchase(r.payment);
      setCheckoutEnabled(r.checkoutEnabled);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Purchase unavailable.");
    }
  }, [id, type]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  async function pay() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ authorizationUrl: string }>(
        "/v1/payments/initialize",
        {
          method: "POST",
          body: JSON.stringify({
            resourceType: type,
            resourceId: id,
            idempotencyKey: `review-${id}-${Date.now()}`,
          }),
        },
      );
      await Linking.openURL(r.authorizationUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment could not open.");
    } finally {
      setBusy(false);
    }
  }
  const money = (v: number) =>
    `₦${(Number(v) / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  return (
    <ToolPage title="Review payment">
      {error ? (
        <>
          <Text accessibilityRole="alert" style={{ color: theme.error }}>
            {error}
          </Text>
          <ToolButton secondary label="Try again" onPress={() => void load()} />
        </>
      ) : null}
      {p ? (
        <>
          <Text
            style={{
              fontSize: 21,
              color: theme.text,
              fontFamily: theme.font.bold,
            }}
          >
            {p.title}
          </Text>
          <Text style={{ color: theme.text }}>Items: {money(p.base_kobo)}</Text>
          <Text style={{ color: theme.text }}>
            Delivery: {money(p.delivery_fee_kobo)}
          </Text>
          {p.fee_snapshot?.delivery ? (
            <Text style={{ color: theme.textMuted }}>
              {p.fee_snapshot.delivery.distanceMetres != null
                ? `Map distance estimate: ${(p.fee_snapshot.delivery.distanceMetres / 1000).toFixed(2)} km`
                : "Delivery uses the configured campus zone fee."}
            </Text>
          ) : null}
          {p.campus_zone_estimate && p.distance_metres != null ? (
            <Text style={{ color: theme.textMuted }}>
              Campus zone estimate ·{" "}
              {(Number(p.distance_metres) / 1000).toFixed(2)} km
            </Text>
          ) : null}
          {Number(p.discount_kobo) > 0 ? (
            <Text style={{ color: theme.text }}>
              Checkout savings: −{money(Number(p.discount_kobo))}
            </Text>
          ) : null}
          {Number(p.cash_due_kobo) > 0 ? (
            <Text style={{ color: theme.text }}>
              Cash to rider at delivery: {money(Number(p.cash_due_kobo))}
            </Text>
          ) : null}
          <Text style={{ color: theme.text, fontFamily: theme.font.bold }}>
            Pay in app: {money(p.amount_kobo)}
          </Text>
          <Text style={{ color: theme.text }}>
            Status: {p.status.replaceAll("_", " ")}
          </Text>
          {p.status === "PENDING_PAYMENT" ? (
            <ToolButton
              disabled={busy || !checkoutEnabled}
              label={
                !checkoutEnabled
                  ? "Checkout is not available yet"
                  : busy
                    ? "Opening checkout…"
                    : `Pay ${money(p.amount_kobo)}`
              }
              onPress={() => void pay()}
            />
          ) : null}
        </>
      ) : !error ? (
        <Text style={{ color: theme.text }}>Loading your fee breakdown…</Text>
      ) : null}
      <ToolButton
        secondary
        label="My purchases"
        onPress={() => router.push("/(tabs)/purchases")}
      />
    </ToolPage>
  );
}
