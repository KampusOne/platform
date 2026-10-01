import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { api } from "@/src/lib/api";
import { useAppearance } from "@/src/lib/appearance";
import { useAuth } from "@/src/auth/auth-context";
type Purchase = {
  id: string;
  title: string;
  status: string;
  access_status: string;
  amount_kobo: number;
  price_kobo: number;
  resource_id: string;
  media_object_id: string;
  can_access_resource: boolean;
  tutor_user_id: string;
  tutor_name: string;
  release_at: string | null;
  reference: string | null;
  payment_status: string | null;
  payment_expires_at: string;
};
export default function LearningLibrary() {
  const { user } = useAuth();
  return <AccountLibrary key={user?.id} />;
}
function AccountLibrary() {
  const { theme } = useAppearance(),
    [items, setItems] = useState<Purchase[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [ready, setReady] = useState(true),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(""),
    [dispute, setDispute] = useState(""),
    [reason, setReason] = useState("");
  const alive = useRef(true),
    generation = useRef(0),
    lock = useRef(false),
    keys = useRef(new Map<string, string>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  const load = useCallback(async (before?: string) => {
    const turn = ++generation.current;
    try {
      const result = await api<{
        ready: boolean;
        purchases: Purchase[];
        nextCursor: string | null;
      }>(
        "/v1/tutor-commerce/purchases" +
          (before ? "?before=" + encodeURIComponent(before) : ""),
      );
      if (!alive.current || generation.current !== turn) return;
      setItems((old) =>
        before
          ? Array.from(
              new Map(
                [...old, ...result.purchases].map((p) => [p.id, p]),
              ).values(),
            )
          : result.purchases,
      );
      setNext(result.nextCursor);
      setReady(result.ready);
      setError("");
    } catch (e) {
      if (alive.current && generation.current === turn)
        setError(
          e instanceof Error
            ? e.message
            : "Your learning purchases could not load. Try again.",
        );
    } finally {
      if (alive.current && generation.current === turn) setLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  async function act(
    p: Purchase,
    kind: "pay" | "check" | "open" | "chat" | "dispute",
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(p.id);
    setError("");
    setNotice("");
    try {
      if (kind === "pay") {
        const requestId = keys.current.get(p.id) ?? randomUUID();
        keys.current.set(p.id, requestId);
        const result = await api<{
          authorizationUrl: string;
          amountKobo: number;
        }>(`/v1/tutor-commerce/purchases/${p.id}/payment`, {
          method: "POST",
          body: JSON.stringify({ requestId }),
        });
        if (!alive.current) return;
        if (result.amountKobo !== Number(p.amount_kobo))
          throw new Error(
            "The checkout total did not match your saved purchase. Refresh its status.",
          );
        await Linking.openURL(result.authorizationUrl);
      }
      if (kind === "check" && p.reference) {
        const result = await api<{ payment: { status: string } }>(
          "/v1/payments/status/" + encodeURIComponent(p.reference),
        );
        if (!alive.current) return;
        setNotice(
          result.payment.status === "SUCCEEDED"
            ? "Payment confirmed. Your material is available."
            : result.payment.status === "REQUIRES_REVIEW"
              ? "Your payment is recorded and awaiting support review. Keep its reference."
              : "Payment is awaiting confirmation.",
        );
        await load();
      }
      if (kind === "open") {
        const result = await api<{ url: string }>(
          `/v1/media/${p.media_object_id}/access`,
          { method: "POST" },
        );
        if (alive.current) await Linking.openURL(result.url);
      }
      if (kind === "chat") {
        const result = await api<{ thread: { id: string } }>(
          "/v1/messages/threads",
          { method: "POST", body: JSON.stringify({ userId: p.tutor_user_id }) },
        );
        if (alive.current)
          router.push({
            pathname: "/conversation",
            params: { id: result.thread.id },
          });
      }
      if (kind === "dispute") {
        await api(`/v1/tutor-commerce/purchases/${p.id}/dispute`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        });
        if (!alive.current) return;
        setDispute("");
        setReason("");
        setNotice(
          "Your report is with support. Access and earnings remain on hold during review.",
        );
        await load();
      }
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "This action could not finish. Your purchase is saved.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy("");
    }
  }
  const money = (value: number) =>
    new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
    }).format(Number(value) / 100);
  return (
    <ToolPage title="My learning purchases">
      <ToolButton
        secondary
        label={loading ? "Loading purchases…" : "Refresh purchases"}
        disabled={Boolean(busy) || loading}
        onPress={() => void load()}
      />
      <ToolButton
        secondary
        label="My booked tutorial sessions"
        disabled={Boolean(busy)}
        onPress={() => router.push("/purchases")}
      />
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.error }}>
          {error}
        </Text>
      ) : null}
      {notice ? <Text style={{ color: theme.text }}>{notice}</Text> : null}
      {!loading && !ready ? (
        <Text style={{ color: theme.textMuted }}>
          Material purchases will be available after the scheduled payment
          update.
        </Text>
      ) : null}
      {!loading && ready && !error && !items.length ? (
        <Text style={{ color: theme.textMuted }}>
          Materials you purchase will appear here with their payment and access
          status.
        </Text>
      ) : null}
      {items.map((p) => (
        <View
          key={p.id}
          style={{
            paddingVertical: 20,
            gap: 11,
            borderBottomWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Text
            style={{
              color: theme.text,
              fontSize: 22,
              fontFamily: theme.font.display,
            }}
          >
            {p.title}
          </Text>
          <Text style={{ color: theme.textMuted }}>
            {p.tutor_name} · {p.access_status.replaceAll("_", " ")}
          </Text>
          <Text style={{ color: theme.text, fontFamily: theme.font.bold }}>
            Total · {money(p.amount_kobo)}
          </Text>
          {Number(p.price_kobo) > Number(p.amount_kobo) ? (
            <Text style={{ color: theme.brand }}>
              You saved {money(Number(p.price_kobo) - Number(p.amount_kobo))} at
              checkout.
            </Text>
          ) : null}
          {p.status === "PENDING_PAYMENT" &&
          p.access_status !== "EXPIRED" &&
          p.payment_status !== "REQUIRES_REVIEW" ? (
            <ToolButton
              disabled={Boolean(busy)}
              label="Resume secure payment"
              onPress={() => void act(p, "pay")}
            />
          ) : null}
          {p.reference && p.status === "PENDING_PAYMENT" ? (
            <>
              <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                Reference {p.reference}
              </Text>
              <ToolButton
                secondary
                disabled={Boolean(busy)}
                label="Check payment"
                onPress={() => void act(p, "check")}
              />
            </>
          ) : null}
          {p.access_status === "EXPIRED" &&
          p.payment_status !== "REQUIRES_REVIEW" ? (
            <ToolButton
              secondary
              label="Review current material price"
              disabled={Boolean(busy)}
              onPress={() =>
                router.push({
                  pathname: "/learning-checkout",
                  params: { resourceId: p.resource_id },
                })
              }
            />
          ) : null}
          {p.can_access_resource ? (
            <>
              <ToolButton
                disabled={Boolean(busy)}
                label="Open purchased material"
                onPress={() => void act(p, "open")}
              />
              <ToolButton
                secondary
                disabled={Boolean(busy)}
                label="Message tutor"
                onPress={() => void act(p, "chat")}
              />
            </>
          ) : null}
          {p.status === "DISPUTED" ? (
            <Text style={{ color: theme.textMuted }}>
              Support is reviewing your report. File access and earnings are
              paused.
            </Text>
          ) : null}
          {p.status === "PAID" &&
          p.release_at &&
          Date.parse(p.release_at) > Date.now() ? (
            <ToolButton
              secondary
              disabled={Boolean(busy)}
              label="Report a purchase problem"
              onPress={() => {
                setDispute(p.id);
                setReason("");
              }}
            />
          ) : null}
          {dispute === p.id ? (
            <>
              <ToolField
                label="What went wrong?"
                value={reason}
                onChangeText={setReason}
                multiline
                maxLength={1000}
              />
              <Text style={{ color: theme.textMuted }}>
                Your report pauses file access and tutor earnings while support
                reviews it.
              </Text>
              <ToolButton
                label="Submit report"
                disabled={Boolean(busy) || reason.trim().length < 10}
                onPress={() => void act(p, "dispute")}
              />
              <ToolButton
                secondary
                label="Cancel report"
                disabled={Boolean(busy)}
                onPress={() => setDispute("")}
              />
            </>
          ) : null}
        </View>
      ))}
      {next ? (
        <ToolButton
          secondary
          disabled={Boolean(busy)}
          label="Load earlier purchases"
          onPress={() => void load(next)}
        />
      ) : null}
    </ToolPage>
  );
}
