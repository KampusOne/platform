import { orderDate, orderStatusLabel } from "@/src/lib/order-presentation";
import {OrderProgress} from "@/src/components/order-progress";
import { useCallback, useRef, useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";
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
  vendor_name?:string;
  image_url?: string | null;
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
    subtotal_kobo?: number;
    delivery_fee_kobo?: number;
    created_at?: string;
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
      refreshing={loading && Boolean(data)}
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
          <View style={{ backgroundColor: theme.surface, borderRadius: 22, borderWidth: 1, borderColor: theme.border, padding: 18, gap: 20 }}>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: theme.surfaceMuted, alignItems: "center", justifyContent: "center" }}><Ionicons name="storefront-outline" size={23} color={theme.accentText} /></View>
              <View style={{ flex: 1, gap: 3 }}><Text numberOfLines={2} style={{ ...text, fontFamily: theme.font.displayStrong, fontSize: 23, lineHeight: 28 }}>{data.order.vendor_name}</Text><Text selectable style={{ ...text, color: theme.textMuted, fontSize: 12 }}>Order #{id.slice(0, 8).toUpperCase()}</Text></View>
              <View style={{ alignItems: "flex-end", gap: 3 }}><Text style={{ ...text, fontFamily: theme.font.bold, fontSize: 19 }}>{money(data.order.total_kobo)}</Text><Text style={{ ...text, color: theme.textMuted, fontSize: 11 }}>Order total</Text></View>
            </View>
            <View style={{ height: 1, backgroundColor: theme.border }} />
            <OrderProgress status={data.order.status} pickup={data.order.fulfilment_mode === 'PICKUP'} />
            {data.order.created_at ? <Text style={{ ...text, color: theme.textMuted, fontSize: 11 }}>Placed {orderDate(data.order.created_at)}</Text> : null}
          </View>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 18, padding: 16, marginTop: 14 }}>
            <Ionicons name={data.order.fulfilment_mode === "PICKUP" ? "storefront-outline" : "location-outline"} size={22} color={theme.accentText} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ ...text, fontFamily: theme.font.semibold }}>{data.order.fulfilment_mode === "PICKUP" ? "Store pickup" : data.order.fulfilment_mode === "VENDOR_DELIVERY" ? "Vendor delivery" : "Rider delivery"}</Text>
              <Text style={{ ...text, color: theme.textMuted }}>{data.order.fulfilment_mode === "PICKUP" ? (data.order.pickup_location || data.order.delivery_location) : data.order.delivery_location}</Text>
              {data.order.fulfilment_mode === "PICKUP" && data.order.pickup_instructions ? <Text style={{ ...text, color: theme.textMuted, fontSize: 12 }}>{data.order.pickup_instructions}</Text> : null}
            </View>
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
                  padding: 16,
                  marginTop: 12,
                  backgroundColor: theme.surface,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: theme.border,
                  gap: 8,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  {item.image_url ? <Image accessibilityLabel={item.name} source={{ uri: item.image_url }} style={{ width: 62, height: 62, borderRadius: 14, backgroundColor: theme.surfaceMuted }} /> : <View style={{ width: 62, height: 62, borderRadius: 14, backgroundColor: theme.surfaceMuted, alignItems: "center", justifyContent: "center" }}><Ionicons name="bag-handle-outline" size={24} color={theme.textMuted} /></View>}
                  <View style={{ flex: 1, gap: 3 }}><Text style={{ ...text, fontFamily: theme.font.semibold }}>{item.name}</Text>{item.vendor_name ? <Text style={{ ...text, color: theme.textMuted, fontSize: 11 }}>From {item.vendor_name}</Text> : null}<Text style={{ ...text, color: theme.textMuted, fontSize: 12 }}>Qty {item.quantity} · {money(item.unit_price_kobo)} each</Text></View>
                  <Text style={{ ...text, fontFamily: theme.font.semibold }}>{money(item.unit_price_kobo * item.quantity)}</Text>
                </View>
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
                    onPress={event => setRating(Math.max(1, event.nativeEvent.locationX < 23 ? value-0.5 : value))}
                    style={{ padding: 8 }}
                  >
                    <Ionicons
                      name={rating >= value ? "star" : rating >= value-0.5 ? "star-half" : "star-outline"}
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
          <View style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, padding: 16, borderRadius: 18, marginTop: 20, gap: 12 }}>
            <Text style={{ ...text, fontFamily: theme.font.semibold, fontSize: 17 }}>Payment summary</Text>
            {data.order.subtotal_kobo != null && Number.isFinite(Number(data.order.subtotal_kobo)) ? <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}><Text style={{ ...text, color: theme.textMuted }}>Items</Text><Text style={text}>{money(data.order.subtotal_kobo)}</Text></View> : null}
            {Number(data.order.delivery_fee_kobo) > 0 ? <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}><Text style={{ ...text, color: theme.textMuted }}>Delivery</Text><Text style={text}>{money(data.order.delivery_fee_kobo!)}</Text></View> : null}
            {data.order.subtotal_kobo != null && Number.isFinite(Number(data.order.subtotal_kobo)) && data.order.total_kobo - data.order.subtotal_kobo - Number(data.order.delivery_fee_kobo || 0) > 0 ? <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}><Text style={{ ...text, color: theme.textMuted }}>Fees</Text><Text style={text}>{money(data.order.total_kobo - data.order.subtotal_kobo - Number(data.order.delivery_fee_kobo || 0))}</Text></View> : null}
            <View style={{ borderTopWidth: 1, borderColor: theme.border, paddingTop: 12, flexDirection: "row", justifyContent: "space-between", gap: 12 }}><Text style={{ ...text, fontFamily: theme.font.semibold }}>Total</Text><Text style={{ ...text, fontFamily: theme.font.bold }}>{money(data.order.total_kobo)}</Text></View>
          </View>
          <Text style={{ ...text, fontFamily: theme.font.semibold, fontSize: 18, marginTop: 24, marginBottom: 8 }}>Order activity</Text>
          {[...data.timeline].reverse().map((event, index) => (
            <View
              key={`${event.occurred_at}-${index}`}
              style={{
                backgroundColor: theme.surface,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: theme.border,
                padding: 12,
                marginTop: 10,
              }}
            >
              <Text style={text}>
                {orderStatusLabel(event.status, data.order.fulfilment_mode === "PICKUP")}
              </Text>
              <Text style={{ ...text, color: theme.textMuted, fontSize: 12 }}>
                {orderDate(event.occurred_at)}
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </ToolPage>
  );
}
