import { orderDate } from "@/src/lib/order-presentation";
import {OrderProgress} from "@/src/components/order-progress";
import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ToolButton, ToolPage } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { MediaImage } from "@/src/components/media-image";
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
    { theme, styles } = useThemeStyles(createStyles),
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
  const pickup = data?.order.fulfilment_mode === "PICKUP";
  const reviewItem = data?.items.find(item => item.product_id === target);
  const itemCount = data?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  return <ToolPage title="Your order" refreshing={loading && Boolean(data)} onRefresh={() => void load()}>
    {error ? <View style={styles.error}>
      <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
      <ToolButton secondary label="Try again" disabled={busy} onPress={() => void load()} />
    </View> : null}
    {loading && !data ? <ScreenSkeleton /> : data ? <View style={styles.content}>
      <View style={styles.summary}>
        <View style={styles.merchant}>
          <View style={styles.shopIcon}><Ionicons name="storefront-outline" size={22} color={theme.accentText} /></View>
          <View style={styles.copy}>
            <Text style={styles.vendor}>{data.order.vendor_name}</Text>
            <Text selectable style={styles.small}>Order #{data.order.id.slice(0, 8).toUpperCase()}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <OrderProgress status={data.order.status} pickup={pickup} timeline={data.timeline} />
        <View style={styles.divider} />
        <View style={styles.fulfilment}>
          <Ionicons name={pickup ? "storefront-outline" : "location-outline"} size={20} color={theme.textMuted} />
          <View style={styles.copy}>
            <Text style={styles.rowTitle}>{pickup ? "Store pickup" : data.order.fulfilment_mode === "VENDOR_DELIVERY" ? "Vendor delivery" : "Rider delivery"}</Text>
            <Text style={styles.body}>{pickup ? (data.order.pickup_location || data.order.delivery_location) : data.order.delivery_location}</Text>
            {pickup && data.order.pickup_instructions ? <Text style={styles.small}>{data.order.pickup_instructions}</Text> : null}
          </View>
        </View>
        {data.order.created_at ? <Text style={styles.small}>Placed {orderDate(data.order.created_at)}</Text> : null}
      </View>
      {data.order.delivery_code && !["DELIVERED", "CANCELLED", "REFUNDED"].includes(data.order.status) ? <View style={styles.confirmation}>
        <Text style={styles.rowTitle}>{pickup ? "Pickup code" : "Delivery code"}</Text>
        <Text selectable style={styles.code}>{data.order.delivery_code}</Text>
        <Text style={styles.small}>Share this only after you receive your order.</Text>
      </View> : null}
      <View style={styles.section}>
        <View style={styles.sectionHeading}><Text accessibilityRole="header" style={styles.sectionTitle}>Your items</Text><Text style={styles.small}>{itemCount} {itemCount === 1 ? "item" : "items"}</Text></View>
        <View style={styles.card}>
          {data.items.map((item, index) => {
            const written = data.reviews.find(r => r.product_id === item.product_id);
            return <View key={item.product_id} style={[styles.item, index > 0 && styles.itemBorder]}>
              <View style={styles.itemRow}>
                {item.image_url ? <MediaImage uri={item.image_url} accessibilityLabel={item.name} style={styles.itemImage} />
                  : <View style={[styles.itemImage, styles.imagePlaceholder]}><Ionicons name="bag-handle-outline" size={24} color={theme.textMuted} /></View>}
                <View style={styles.copy}>
                  <Text style={styles.rowTitle}>{item.name}</Text>
                  <Text style={styles.small}>Qty {item.quantity} · {money(item.unit_price_kobo)} each</Text>
                  <Text style={styles.itemPrice}>{money(item.unit_price_kobo * item.quantity)}</Text>
                </View>
              </View>
              {written ? <View style={styles.writtenReview}>
                <View style={styles.reviewScore}><Ionicons name="star" size={14} color={theme.accentText} /><Text style={styles.link}>Your rating · {written.rating}/5</Text></View>
                {written.body ? <Text style={styles.body}>{written.body}</Text> : null}
              </View> : data.order.status === "DELIVERED" ? <Pressable accessibilityRole="button" accessibilityLabel={`Review ${item.name}`} disabled={busy}
                onPress={() => { setTarget(item.product_id); setRating(0); setBody(""); }}
                style={({ pressed }) => [styles.reviewButton, pressed && styles.pressed]}>
                <Ionicons name="star-outline" size={17} color={theme.accentText} /><Text style={styles.link}>{target === item.product_id ? "Writing your review" : "Review product"}</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.accentText} />
              </Pressable> : null}
            </View>;
          })}
        </View>
      </View>
      {reviewItem && data.order.status === "DELIVERED" ? <View style={[styles.card, styles.reviewForm]}>
        <View style={styles.sectionHeading}>
          <View style={styles.copy}><Text accessibilityRole="header" style={styles.sectionTitle}>How was your purchase?</Text><Text style={styles.small}>{reviewItem.name}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close review" disabled={busy} onPress={() => { setTarget(null); router.setParams({ review: undefined }); }} style={styles.closeButton}><Ionicons name="close" size={21} color={theme.textMuted} /></Pressable>
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel="Rate this product" style={styles.stars}>
          {[1, 2, 3, 4, 5].map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={`${value} out of 5 stars`}
            accessibilityState={{ selected: rating === value || rating === value - 0.5, disabled: busy }} disabled={busy}
            onPress={event => setRating(Math.max(1, event.nativeEvent.locationX < 22 ? value - 0.5 : value))} style={styles.starButton}>
            <Ionicons name={rating >= value ? "star" : rating >= value - 0.5 ? "star-half" : "star-outline"} size={28} color={theme.accentText} />
          </Pressable>)}
        </View>
        <Text accessibilityLiveRegion="polite" style={styles.small}>{rating ? `${rating} out of 5 stars` : "Tap a star to rate your purchase"}</Text>
        <TextInput accessibilityLabel="Your product review, optional" value={body} onChangeText={setBody} editable={!busy} multiline maxLength={1000}
          placeholder="Add a comment (optional)" placeholderTextColor={theme.textMuted} style={styles.reviewInput} />
        <ToolButton label={busy ? "Publishing…" : "Publish review"} disabled={busy || rating === 0 || (body.trim().length > 0 && body.trim().length < 3)} onPress={() => void publish()} />
      </View> : null}
      {data.order.status === "PENDING_PAYMENT" ? <ToolButton label="Review payment" onPress={() => router.push({ pathname: "/payment-review", params: { id, type: "STORE_ORDER" } })} /> : null}
      <View style={[styles.card, styles.payment]}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Payment summary</Text>
        {data.order.subtotal_kobo != null && Number.isFinite(Number(data.order.subtotal_kobo)) ? <View style={styles.amountRow}><Text style={styles.body}>Items</Text><Text style={styles.amount}>{money(data.order.subtotal_kobo)}</Text></View> : null}
        {Number(data.order.delivery_fee_kobo) > 0 ? <View style={styles.amountRow}><Text style={styles.body}>Delivery</Text><Text style={styles.amount}>{money(data.order.delivery_fee_kobo!)}</Text></View> : null}
        {data.order.subtotal_kobo != null && Number.isFinite(Number(data.order.subtotal_kobo)) && data.order.total_kobo - data.order.subtotal_kobo - Number(data.order.delivery_fee_kobo || 0) > 0 ? <View style={styles.amountRow}><Text style={styles.body}>Fees</Text><Text style={styles.amount}>{money(data.order.total_kobo - data.order.subtotal_kobo - Number(data.order.delivery_fee_kobo || 0))}</Text></View> : null}
        <View style={styles.totalRow}><Text style={styles.rowTitle}>Total</Text><Text style={styles.total}>{money(data.order.total_kobo)}</Text></View>
      </View>
    </View> : null}
  </ToolPage>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  content: { gap: 24 },
  summary: { backgroundColor: theme.surface, borderRadius: 20, borderWidth: 1, borderColor: theme.border, padding: 18, gap: 16 },
  merchant: { flexDirection: "row", gap: 12, alignItems: "center" },
  shopIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: theme.surfaceMuted, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  vendor: { fontFamily: theme.font.display, fontSize: 20, lineHeight: 26, color: theme.text },
  divider: { height: 1, backgroundColor: theme.border },
  fulfilment: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  body: { fontFamily: theme.font.body, fontSize: 13, lineHeight: 21, color: theme.textMuted },
  small: { fontFamily: theme.font.body, fontSize: 11, lineHeight: 17, color: theme.textMuted },
  rowTitle: { fontFamily: theme.font.semibold, fontSize: 14, lineHeight: 21, color: theme.text },
  section: { gap: 14 },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  sectionTitle: { fontFamily: theme.font.display, fontSize: 18, lineHeight: 25, color: theme.text },
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 18, overflow: "hidden" },
  item: { padding: 16, gap: 14 },
  itemBorder: { borderTopWidth: 1, borderTopColor: theme.border },
  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  itemImage: { width: 64, height: 72, borderRadius: 12, backgroundColor: theme.surfaceMuted },
  imagePlaceholder: { alignItems: "center", justifyContent: "center" },
  itemPrice: { fontFamily: theme.font.semibold, fontSize: 14, lineHeight: 21, color: theme.text, marginTop: 2 },
  reviewButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "stretch", borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 4 },
  link: { fontFamily: theme.font.medium, fontSize: 12, lineHeight: 18, color: theme.accentText, flexShrink: 1 },
  writtenReview: { gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.border },
  reviewScore: { flexDirection: "row", gap: 6, alignItems: "center" },
  reviewForm: { padding: 16, gap: 10 },
  closeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  stars: { flexDirection: "row", justifyContent: "space-between", maxWidth: 280 },
  starButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  reviewInput: { fontFamily: theme.font.body, fontSize: 13, lineHeight: 21, color: theme.text, minHeight: 96, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12, textAlignVertical: "top" },
  confirmation: { gap: 8, padding: 18, borderRadius: 16, backgroundColor: theme.surfaceMuted },
  code: { fontFamily: theme.font.bold, fontSize: 28, letterSpacing: 6, color: theme.text },
  payment: { padding: 18, gap: 14 },
  amountRow: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 12 },
  amount: { fontFamily: theme.font.medium, fontSize: 13, lineHeight: 21, color: theme.text },
  totalRow: { borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 14, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 12 },
  total: { fontFamily: theme.font.bold, fontSize: 19, lineHeight: 26, color: theme.text },
  error: { gap: 10, marginVertical: 16 },
  errorText: { fontFamily: theme.font.body, fontSize: 14, lineHeight: 22, color: theme.error },
  pressed: { opacity: 0.55 },
});
