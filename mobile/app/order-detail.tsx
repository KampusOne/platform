import { useCallback, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ToolButton, ToolPage } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { useToast } from "@/src/components/toast";

type Item = {
  product_id: string;
  name: string;
  quantity: number;
  unit_price_kobo: number;
};
type Detail = {
  order: {
    id: string;
    vendor_name: string;
    status: string;
    fulfilment_mode: string;
    total_kobo: number;
    delivery_code?: string;
    delivery_location: string;
    pickup_location: string | null;
    pickup_instructions: string | null;
  };
  items: Item[];
  reviews: { product_id: string; rating: number; body: string | null }[];
  timeline: { status: string; occurred_at: string }[];
};
const money = (value: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    Number(value) / 100,
  );
export default function OrderDetail() {
  const { id, review } = useLocalSearchParams<{
      id: string;
      review?: string;
    }>(),
    { theme } = useAppearance(),
    toast = useToast();
  const [data, setData] = useState<Detail>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<string | null>(null),
    [rating, setRating] = useState(0),
    [body, setBody] = useState("");
  const generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await api<Detail>(
        `/v1/student/orders/${encodeURIComponent(id ?? "")}`,
      );
      if (version !== generation.current) return;
      setData(result);
      if (review === "1" && result.order.status === "DELIVERED")
        setTarget(
          result.items.find(
            (i) => !result.reviews.some((r) => r.product_id === i.product_id),
          )?.product_id ?? null,
        );
    } catch (e) {
      if (version === generation.current)
        setError(e instanceof Error ? e.message : "Your order could not load.");
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, [id, review]);
  useFocusEffect(
    useCallback(() => {
      setData(undefined);
      setTarget(null);
      setRating(0);
      setBody("");
      void load();
      return () => {
        generation.current++;
      };
    }, [load]),
  );
  async function publish() {
    if (!target || !rating || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/v1/student/product-reviews", {
        method: "POST",
        body: JSON.stringify({
          orderId: id,
          productId: target,
          rating,
          body: body.trim() || null,
        }),
      });
      setTarget(null);
      setRating(0);
      setBody("");
      router.setParams({ review: undefined });
      toast("Your review is published", "success");
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your review could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  const text = {
    color: theme.text,
    fontFamily: theme.font.body,
    fontSize: 14,
    lineHeight: 22,
  };
  return (
    <ToolPage
      title="Your order"
      refreshing={loading}
      onRefresh={() => void load()}
    >
      {error ? (
        <View style={{ gap: 10, marginVertical: 16 }}>
          <Text
            accessibilityRole="alert"
            style={{ ...text, color: theme.error }}
          >
            {error}
          </Text>
          <ToolButton
            secondary
            label="Try again"
            disabled={busy}
            onPress={() => void load()}
          />
        </View>
      ) : null}
      {loading && !data ? (
        <ScreenSkeleton />
      ) : data ? (
        <>
          <Text
            style={{
              ...text,
              fontFamily: theme.font.displayStrong,
              fontSize: 26,
              lineHeight: 32,
            }}
          >
            {data.order.vendor_name}
          </Text>
          <Text style={{ ...text, color: theme.textMuted, marginTop: 8 }}>
            #{id.slice(0, 8)} ·{" "}
            {data.order.status.replaceAll("_", " ").toLowerCase()}
          </Text>
          <Text
            style={{
              ...text,
              fontFamily: theme.font.semibold,
              marginVertical: 20,
            }}
          >
            {money(data.order.total_kobo)}
          </Text>
          <View
            style={{
              paddingVertical: 18,
              borderTopWidth: 1,
              borderBottomWidth: 1,
              borderColor: theme.border,
              gap: 8,
            }}
          >
            <Text style={{ ...text, fontFamily: theme.font.semibold }}>
              {data.order.fulfilment_mode === "PICKUP"
                ? "Store pickup"
                : data.order.fulfilment_mode === "VENDOR_DELIVERY"
                  ? "Vendor delivery"
                  : "Rider delivery"}
            </Text>
            <Text style={text}>
              {data.order.fulfilment_mode === "PICKUP"
                ? (data.order.pickup_location ?? data.order.delivery_location)
                : data.order.delivery_location}
            </Text>
            {data.order.fulfilment_mode === "PICKUP" &&
            data.order.pickup_instructions ? (
              <Text style={{ ...text, color: theme.textMuted }}>
                {data.order.pickup_instructions}
              </Text>
            ) : null}
          </View>
          {data.order.delivery_code ? (
            <View
              style={{
                marginVertical: 20,
                padding: 18,
                backgroundColor: theme.surfaceMuted,
                borderRadius: 12,
              }}
            >
              <Text style={{ ...text, fontFamily: theme.font.semibold }}>
                {data.order.fulfilment_mode === "PICKUP"
                  ? "Pickup confirmation code"
                  : "Delivery confirmation code"}
              </Text>
              <Text style={{ ...text, color: theme.textMuted }}>
                Share this only after you receive your order.
              </Text>
              <Text
                selectable
                style={{
                  color: theme.text,
                  fontFamily: theme.font.displayStrong,
                  fontSize: 32,
                  letterSpacing: 8,
                  marginTop: 12,
                }}
              >
                {data.order.delivery_code}
              </Text>
            </View>
          ) : null}
          <Text
            style={{
              ...text,
              fontFamily: theme.font.semibold,
              fontSize: 18,
              marginTop: 24,
            }}
          >
            Your items
          </Text>
          {data.items.map((item) => {
            const written = data.reviews.find(
              (r) => r.product_id === item.product_id,
            );
            return (
              <View
                key={item.product_id}
                style={{
                  paddingVertical: 18,
                  borderBottomWidth: 1,
                  borderColor: theme.border,
                  gap: 8,
                }}
              >
                <Text style={{ ...text, fontFamily: theme.font.semibold }}>
                  {item.name}
                </Text>
                <Text style={{ ...text, color: theme.textMuted }}>
                  {item.quantity} × {money(item.unit_price_kobo)}
                </Text>
                {written ? (
                  <Text style={text}>
                    You rated this {written.rating}/5
                    {written.body ? ` · ${written.body}` : ""}
                  </Text>
                ) : data.order.status === "DELIVERED" ? (
                  <ToolButton
                    secondary
                    label="Review this product"
                    disabled={busy}
                    onPress={() => {
                      setTarget(item.product_id);
                      setRating(0);
                      setBody("");
                    }}
                  />
                ) : null}
              </View>
            );
          })}
          {target && data.order.status === "DELIVERED" ? (
            <View style={{ gap: 16, paddingVertical: 24 }}>
              <Text
                style={{
                  ...text,
                  fontFamily: theme.font.semibold,
                  fontSize: 18,
                }}
              >
                Your review
              </Text>
              <Text style={{ ...text, color: theme.textMuted }}>
                Choose a rating when you are ready. Reviewing is optional.
              </Text>
              <View
                accessibilityRole="radiogroup"
                style={{ flexDirection: "row", gap: 10 }}
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityLabel={`${value} out of 5 stars`}
                    accessibilityState={{
                      selected: rating === value,
                      disabled: busy,
                    }}
                    disabled={busy}
                    onPress={() => setRating(value)}
                    style={{ padding: 8 }}
                  >
                    <Ionicons
                      name={rating >= value ? "star" : "star-outline"}
                      size={30}
                      color={theme.brand}
                    />
                  </Pressable>
                ))}
              </View>
              <TextInput
                accessibilityLabel="Your product review, optional"
                value={body}
                onChangeText={setBody}
                editable={!busy}
                multiline
                maxLength={1000}
                placeholder="Tell other students about your purchase"
                placeholderTextColor={theme.textMuted}
                style={{
                  ...text,
                  minHeight: 100,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 12,
                  padding: 14,
                  textAlignVertical: "top",
                }}
              />
              <ToolButton
                label={busy ? "Publishing…" : "Publish review"}
                disabled={
                  busy ||
                  rating === 0 ||
                  (body.trim().length > 0 && body.trim().length < 3)
                }
                onPress={() => void publish()}
              />
              <ToolButton
                secondary
                label="Review later"
                disabled={busy}
                onPress={() => {
                  setTarget(null);
                  router.setParams({ review: undefined });
                }}
              />
            </View>
          ) : null}
          {data.order.status === "PENDING_PAYMENT" ? (
            <ToolButton
              label="Review payment"
              onPress={() =>
                router.push({
                  pathname: "/payment-review",
                  params: { id, type: "STORE_ORDER" },
                })
              }
            />
          ) : null}
          <Text
            style={{
              ...text,
              fontFamily: theme.font.semibold,
              fontSize: 18,
              marginTop: 24,
            }}
          >
            Order activity
          </Text>
          {data.timeline.map((event, index) => (
            <View
              key={`${event.occurred_at}-${index}`}
              style={{
                borderLeftWidth: 2,
                borderColor: theme.border,
                padding: 12,
                marginTop: 10,
              }}
            >
              <Text style={text}>
                {event.status.replaceAll("_", " ").toLowerCase()}
              </Text>
              <Text style={{ ...text, color: theme.textMuted, fontSize: 12 }}>
                {new Date(event.occurred_at).toLocaleString()}
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </ToolPage>
  );
}
