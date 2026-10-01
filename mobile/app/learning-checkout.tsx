import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import { ToolPage, ToolButton } from "@/src/components/toolkit";
import { api } from "@/src/lib/api";
import { useAppearance } from "@/src/lib/appearance";
import { useAuth } from "@/src/auth/auth-context";
type Quote = {
  id: string;
  title: string;
  priceKobo: number;
  amountKobo: number;
  discountKobo: number;
  expiresAt: string;
};
export default function LearningCheckout() {
  const { resourceId, priceKobo } = useLocalSearchParams<{
      resourceId?: string;
      priceKobo?: string;
    }>(),
    { user } = useAuth();
  return (
    <AccountCheckout
      key={`${user?.id}.${resourceId}`}
      resourceId={resourceId}
      displayedPrice={priceKobo}
    />
  );
}
function AccountCheckout({
  resourceId,
  displayedPrice,
}: {
  resourceId: string | undefined;
  displayedPrice: string | undefined;
}) {
  const { theme } = useAppearance(),
    [quote, setQuote] = useState<Quote | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [purchase, setPurchase] = useState(""),
    [notice, setNotice] = useState("");
  const key = useRef(randomUUID()),
    alive = useRef(true),
    lock = useRef(false),
    request = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current++;
    };
  }, []);
  const load = useCallback(
    async (refresh = false) => {
      if (!resourceId || lock.current) return;
      if (refresh) key.current = randomUUID();
      const turn = ++request.current;
      setError("");
      try {
        const resource = await api<{ resource: { price_kobo: number } }>(
          "/v1/student/tutorial-resources/" + encodeURIComponent(resourceId),
        );
        const expectedPriceKobo =
          refresh || !displayedPrice
            ? Number(resource.resource.price_kobo)
            : Number(displayedPrice);
        const result = await api<{ quote: Quote }>("/v1/tutor-commerce/quote", {
          method: "POST",
          body: JSON.stringify({
            resourceId,
            requestId: key.current,
            expectedPriceKobo,
          }),
        });
        if (alive.current && request.current === turn) setQuote(result.quote);
      } catch (e) {
        if (alive.current && request.current === turn)
          setError(
            e instanceof Error
              ? e.message
              : "The price could not load. Try again.",
          );
      }
    },
    [resourceId, displayedPrice],
  );
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  async function buy() {
    if (!quote || lock.current || error) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        purchase: { id: string; status: string; amountKobo: number };
      }>("/v1/tutor-commerce/purchases", {
        method: "POST",
        body: JSON.stringify({ quoteId: quote.id }),
      });
      if (!alive.current) return;
      setPurchase(result.purchase.id);
      if (
        result.purchase.status === "PAID" ||
        result.purchase.status === "DISPUTED"
      ) {
        router.replace("/learning-library");
        return;
      }
      if (result.purchase.id !== quote.id) {
        setNotice(
          "A purchase for this material is already saved. Open your learning purchases to resume its original total.",
        );
        return;
      }
      if (
        result.purchase.status !== "PENDING_PAYMENT" ||
        result.purchase.amountKobo !== quote.amountKobo
      )
        throw new Error(
          "Refresh this purchase before opening payment. Its total must match the reviewed quote.",
        );
      const payment = await api<{
        authorizationUrl: string;
        amountKobo: number;
      }>(`/v1/tutor-commerce/purchases/${result.purchase.id}/payment`, {
        method: "POST",
        body: JSON.stringify({ requestId: key.current }),
      });
      if (!alive.current) return;
      if (payment.amountKobo !== quote.amountKobo)
        throw new Error(
          "The payment total changed. Review your saved purchase before paying.",
        );
      await Linking.openURL(payment.authorizationUrl);
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "Checkout could not open. Your saved purchase can be resumed.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const money = (v: number) =>
    new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
    }).format(v / 100);
  return (
    <ToolPage title="Learning checkout">
      {!resourceId ? (
        <>
          <Text style={{ color: theme.text }}>
            Choose a published learning material or book a session from Tutors.
          </Text>
          <ToolButton
            label="Browse tutors and materials"
            onPress={() => router.replace("/tutorials")}
          />
        </>
      ) : null}
      {error ? (
        <>
          <Text accessibilityRole="alert" style={{ color: theme.error }}>
            {error}
          </Text>
          <ToolButton
            secondary
            label="Refresh material price"
            disabled={busy}
            onPress={() => void load(true)}
          />
        </>
      ) : null}
      {resourceId && !quote && !error ? (
        <Text style={{ color: theme.textMuted }}>
          Preparing your inclusive price…
        </Text>
      ) : null}
      {quote ? (
        <View style={{ gap: 16, paddingVertical: 16 }}>
          <Text
            style={{
              color: theme.text,
              fontSize: 24,
              fontFamily: theme.font.display,
            }}
          >
            {quote.title}
          </Text>
          <Text style={{ color: theme.text, lineHeight: 23 }}>
            Personal access to this learning material. Payment opens for the
            exact reviewed total.
          </Text>
          <Text style={{ color: theme.text }}>
            Listed price · {money(quote.priceKobo)}
          </Text>
          {quote.discountKobo > 0 ? (
            <Text style={{ color: theme.brand }}>
              Checkout saving · −{money(quote.discountKobo)}
            </Text>
          ) : null}
          <Text
            style={{
              color: theme.text,
              fontSize: 22,
              fontFamily: theme.font.bold,
            }}
          >
            Total · {money(quote.amountKobo)}
          </Text>
          <Text style={{ color: theme.textMuted, lineHeight: 21 }}>
            Access starts after payment is verified. You can report a purchase
            problem during the first seven days.
          </Text>
          <ToolButton
            label={
              busy
                ? "Opening secure checkout…"
                : `Pay ${money(quote.amountKobo)}`
            }
            disabled={busy || Boolean(error) || Boolean(notice)}
            onPress={() => void buy()}
          />
        </View>
      ) : null}
      {notice ? <Text style={{ color: theme.text }}>{notice}</Text> : null}
      {purchase ? (
        <Text style={{ color: theme.textMuted, lineHeight: 21 }}>
          Your purchase is saved. Returning from checkout alone does not unlock
          the material; check its verified status in your learning purchases.
        </Text>
      ) : null}
      <ToolButton
        secondary
        label="My learning purchases"
        disabled={busy}
        onPress={() => router.push("/learning-library")}
      />
    </ToolPage>
  );
}
