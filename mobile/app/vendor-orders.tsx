import { useCallback, useRef, useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ToolButton, ToolPage } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { EmptyResult } from "@/src/components/product-ui";
import { useAppearance } from "@/src/lib/appearance";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/lib/api";

type Order = {
  id: string;
  status: string;
  total_kobo: number;
  item_count: number;
  created_at: string;
  zone_name: string | null;
  fulfilment_mode: string;
};
type Detail = {
  order: Order & {
    recipient_name: string | null;
    recipient_phone_e164: string | null;
    delivery_location: string | null;
    delivery_landmark: string | null;
    delivery_note: string | null;
  };
  items: {
    product_id: string;
    name: string;
    quantity: number;
    unit_price_kobo: number;
  }[];
  timeline: { status: string; occurred_at: string; note: string | null }[];
  delivery: {
    status: string;
    request_posted_at: string | null;
    rider_user_id: string | null;
    rider_name: string | null;
    rider_phone: string | null;
  } | null;
  fulfilmentReady: boolean;
};
const money = (value: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    value / 100,
  );
const label = (value: string) =>
  value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
const tabs = ["All", "New", "Active", "Completed"] as const;
export default function VendorOrders() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { theme } = useAppearance();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<string | null>(id ?? null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [detail, setDetail] = useState<Detail>();
  const [tab, setTab] = useState<(typeof tabs)[number]>("All");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickupCode, setPickupCode] = useState("");
  const [handoffCode, setHandoffCode] = useState("");
  const generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await api<{ orders: Order[] }>("/v1/agents/orders");
      if (version === generation.current) setOrders(result.orders);
    } catch (e) {
      if (version === generation.current)
        setError(
          e instanceof Error ? e.message : "Your orders could not load.",
        );
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, []);
  const readDetail = useCallback(async (orderId: string) => {
    setDetailLoading(true);
    setError("");
    setPickupCode("");
    try {
      const result = await api<Detail>(`/v1/agents/orders/${orderId}`);
      if (selectedRef.current === orderId) setDetail(result);
    } catch (e) {
      if (selectedRef.current === orderId)
        setError(e instanceof Error ? e.message : "This order could not load.");
    } finally {
      if (selectedRef.current === orderId) setDetailLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
      if (selectedRef.current) void readDetail(selectedRef.current);
      return () => {
        generation.current++;
      };
    }, [load, readDetail]),
  );
  function choose(orderId: string) {
    selectedRef.current = orderId;
    setSelected(orderId);
    setDetail(undefined);
    void readDetail(orderId);
  }
  async function update(status: "ACCEPTED" | "READY") {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await api(`/v1/agents/orders/${selected}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await Promise.all([load(), readDetail(selected)]);
      toast(
        status === "ACCEPTED" ? "Order accepted" : "Order ready for handoff",
        "success",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This order could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function showPickupCode() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      setPickupCode(
        (
          await api<{ code: string }>(
            `/v1/agents/orders/${selected}/pickup-code`,
          )
        ).code,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The pickup code is unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function fulfil(action: "rider-request" | "dispatch" | "handoff") {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/v1/agents/orders/${selected}/${action}`, {
        method: "POST",
        ...(action === "handoff"
          ? { body: JSON.stringify({ code: handoffCode }) }
          : {}),
      });
      setHandoffCode("");
      await Promise.all([load(), readDetail(selected)]);
      toast(
        action === "rider-request"
          ? "Rider request posted"
          : action === "dispatch"
            ? "Delivery started"
            : "Buyer handoff confirmed",
        "success",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This order could not be updated.",
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
  const visible = orders.filter(
    (order) =>
      tab === "All" ||
      (tab === "New"
        ? order.status === "PAID"
        : tab === "Completed"
          ? order.status === "DELIVERED"
          : ["ACCEPTED", "READY", "IN_DELIVERY"].includes(order.status)),
  );
  return (
    <ToolPage
      title="Store orders"
      refreshing={loading}
      onRefresh={() => {
        void load();
        if (selected) void readDetail(selected);
      }}
    >
      {error ? (
        <Text accessibilityRole="alert" style={{ ...text, marginBottom: 16 }}>
          {error}
        </Text>
      ) : null}
      {selected ? (
        <>
          <ToolButton
            secondary
            label="Back to order list"
            disabled={busy}
            onPress={() => {
              selectedRef.current = null;
              setSelected(null);
              setDetail(undefined);
              setPickupCode("");
              setError("");
            }}
          />
          {detailLoading && !detail ? (
            <ScreenSkeleton />
          ) : !detail ? (
            <ToolButton
              secondary
              label="Retry order details"
              onPress={() => void readDetail(selected)}
            />
          ) : (
            <>
              <View
                style={{
                  paddingVertical: 20,
                  borderBottomWidth: 1,
                  borderColor: theme.border,
                }}
              >
                <Text
                  style={{
                    ...text,
                    color: theme.accentText,
                    fontFamily: theme.font.semibold,
                  }}
                >
                  {label(detail.order.status)}
                </Text>
                <Text
                  style={{
                    ...text,
                    fontFamily: theme.font.displayStrong,
                    fontSize: 26,
                    marginTop: 8,
                  }}
                >
                  {money(detail.order.total_kobo)}
                </Text>
                <Text style={{ ...text, color: theme.textMuted, marginTop: 8 }}>
                  Order {detail.order.id.slice(0, 8).toUpperCase()} ·{" "}
                  {new Date(detail.order.created_at).toLocaleString()}
                </Text>
              </View>
              {detail.items.map((item) => (
                <View
                  key={item.product_id}
                  style={{
                    flexDirection: "row",
                    gap: 12,
                    paddingVertical: 16,
                    borderBottomWidth: 1,
                    borderColor: theme.border,
                  }}
                >
                  <Text style={{ ...text, flex: 1 }}>
                    {item.quantity} × {item.name}
                  </Text>
                  <Text style={{ ...text, fontFamily: theme.font.semibold }}>
                    {money(item.unit_price_kobo * item.quantity)}
                  </Text>
                </View>
              ))}
              {detail.order.recipient_name || detail.order.delivery_location ? (
                <View style={{ paddingVertical: 20, gap: 6 }}>
                  <Text style={{ ...text, fontFamily: theme.font.semibold }}>
                    Delivery details
                  </Text>
                  {detail.order.recipient_name ? (
                    <Text style={text}>{detail.order.recipient_name}</Text>
                  ) : null}
                  {detail.order.delivery_location ? (
                    <Text style={text}>{detail.order.delivery_location}</Text>
                  ) : null}
                  {detail.order.delivery_landmark ? (
                    <Text style={{ ...text, color: theme.textMuted }}>
                      {detail.order.delivery_landmark}
                    </Text>
                  ) : null}
                  {detail.order.delivery_note ? (
                    <Text style={text}>{detail.order.delivery_note}</Text>
                  ) : null}
                  {detail.order.recipient_phone_e164 ? (
                    <ToolButton
                      secondary
                      label="Call customer"
                      onPress={() => {
                        void Linking.openURL(
                          `tel:${detail.order.recipient_phone_e164}`,
                        ).catch(() =>
                          toast(
                            "Calling could not open on this device.",
                            "error",
                          ),
                        );
                      }}
                    />
                  ) : null}
                </View>
              ) : null}
              {detail.order.status === "PAID" ? (
                <ToolButton
                  label="Accept order"
                  disabled={busy}
                  onPress={() => void update("ACCEPTED")}
                />
              ) : null}
              {detail.order.status === "ACCEPTED" ? (
                <ToolButton
                  label="Mark ready for handoff"
                  disabled={busy}
                  onPress={() => void update("READY")}
                />
              ) : null}
              {detail.order.status === "READY" &&
              detail.order.fulfilment_mode === "RIDER" ? (
                <>
                  {detail.fulfilmentReady &&
                  !detail.delivery?.request_posted_at ? (
                    <ToolButton
                      label="Request a rider"
                      disabled={busy}
                      onPress={() => void fulfil("rider-request")}
                    />
                  ) : null}
                  <ToolButton
                    secondary
                    label="Show rider pickup code"
                    disabled={busy}
                    onPress={() => void showPickupCode()}
                  />
                </>
              ) : null}
              {detail.order.fulfilment_mode === "VENDOR_DELIVERY" &&
              detail.order.status === "READY" ? (
                <ToolButton
                  label="Start vendor delivery"
                  disabled={busy}
                  onPress={() => void fulfil("dispatch")}
                />
              ) : null}
              {(detail.order.fulfilment_mode === "PICKUP" &&
                detail.order.status === "READY") ||
              (detail.order.fulfilment_mode === "VENDOR_DELIVERY" &&
                detail.order.status === "IN_DELIVERY") ? (
                <View style={{ gap: 12, marginVertical: 18 }}>
                  <Text style={text}>
                    Ask the buyer for their confirmation code after handing over
                    the order.
                  </Text>
                  <TextInput
                    accessibilityLabel="Buyer confirmation code"
                    value={handoffCode}
                    onChangeText={(value) =>
                      setHandoffCode(value.replace(/\D/g, ""))
                    }
                    editable={!busy}
                    maxLength={6}
                    keyboardType="number-pad"
                    placeholder="6-digit confirmation code"
                    placeholderTextColor={theme.textMuted}
                    style={{
                      ...text,
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 10,
                      padding: 14,
                    }}
                  />
                  <ToolButton
                    label="Confirm buyer handoff"
                    disabled={busy || handoffCode.length !== 6}
                    onPress={() => void fulfil("handoff")}
                  />
                </View>
              ) : null}
              {detail.delivery?.rider_user_id ? (
                <View style={{ gap: 12, marginVertical: 18 }}>
                  <Text style={{ ...text, fontFamily: theme.font.semibold }}>
                    Rider · {detail.delivery.rider_name}
                  </Text>
                  <ToolButton
                    secondary
                    label="Message rider"
                    disabled={busy}
                    onPress={() => {
                      void api<{ thread: { id: string } }>(
                        "/v1/messages/threads",
                        {
                          method: "POST",
                          body: JSON.stringify({
                            userId: detail.delivery!.rider_user_id,
                          }),
                        },
                      )
                        .then((result) =>
                          router.push({
                            pathname: "/conversation",
                            params: { id: result.thread.id },
                          }),
                        )
                        .catch((e) =>
                          toast(
                            e instanceof Error
                              ? e.message
                              : "Messaging could not open.",
                            "error",
                          ),
                        );
                    }}
                  />
                  {detail.delivery.rider_phone ? (
                    <ToolButton
                      secondary
                      label="Call rider"
                      onPress={() => {
                        void Linking.openURL(
                          `tel:${detail.delivery!.rider_phone}`,
                        ).catch(() =>
                          toast("Calling could not open.", "error"),
                        );
                      }}
                    />
                  ) : null}
                </View>
              ) : detail.delivery?.request_posted_at ? (
                <Text
                  style={{
                    ...text,
                    color: theme.textMuted,
                    marginVertical: 12,
                  }}
                >
                  Your request is visible to available campus riders.
                </Text>
              ) : null}
              {pickupCode ? (
                <View
                  style={{
                    padding: 20,
                    marginVertical: 14,
                    backgroundColor: theme.surfaceMuted,
                    borderRadius: 12,
                  }}
                >
                  <Text style={{ ...text, fontFamily: theme.font.semibold }}>
                    Share only with the rider collecting this order
                  </Text>
                  <Text
                    selectable
                    style={{
                      ...text,
                      fontFamily: theme.font.displayStrong,
                      fontSize: 32,
                      letterSpacing: 8,
                      paddingVertical: 14,
                    }}
                  >
                    {pickupCode}
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
                Order activity
              </Text>
              {detail.timeline.map((event, index) => (
                <View
                  key={`${event.occurred_at}-${index}`}
                  style={{
                    borderLeftWidth: 2,
                    borderColor: theme.border,
                    paddingLeft: 14,
                    paddingVertical: 12,
                  }}
                >
                  <Text style={{ ...text, fontFamily: theme.font.medium }}>
                    {label(event.status)}
                  </Text>
                  <Text
                    style={{ ...text, color: theme.textMuted, fontSize: 12 }}
                  >
                    {new Date(event.occurred_at).toLocaleString()}
                  </Text>
                  {event.note ? <Text style={text}>{event.note}</Text> : null}
                </View>
              ))}
            </>
          )}
        </>
      ) : (
        <>
          <View
            style={{
              flexDirection: "row",
              gap: 16,
              borderBottomWidth: 1,
              borderColor: theme.border,
              marginBottom: 16,
            }}
          >
            {tabs.map((value) => (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: value === tab }}
                onPress={() => setTab(value)}
                style={{
                  minHeight: 44,
                  justifyContent: "center",
                  borderBottomWidth: 2,
                  borderColor: value === tab ? theme.brand : "transparent",
                }}
              >
                <Text
                  style={{
                    ...text,
                    fontFamily: theme.font.semibold,
                    color: value === tab ? theme.accentText : theme.textMuted,
                  }}
                >
                  {value}
                </Text>
              </Pressable>
            ))}
          </View>
          {loading && !orders.length ? (
            <ScreenSkeleton variant="list" />
          ) : visible.length ? (
            visible.map((order) => (
              <Pressable
                key={order.id}
                accessibilityRole="button"
                accessibilityLabel={`Order ${order.id.slice(0, 8)}, ${label(order.status)}`}
                onPress={() => choose(order.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 14,
                  paddingVertical: 20,
                  borderBottomWidth: 1,
                  borderColor: theme.border,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ ...text, fontFamily: theme.font.semibold }}>
                    {label(order.status)} · {order.item_count} item
                    {order.item_count === 1 ? "" : "s"}
                  </Text>
                  <Text
                    style={{
                      ...text,
                      color: theme.textMuted,
                      fontSize: 12,
                      marginTop: 6,
                    }}
                  >
                    {order.id.slice(0, 8).toUpperCase()} ·{" "}
                    {new Date(order.created_at).toLocaleDateString()}
                  </Text>
                </View>
                <Text style={{ ...text, fontFamily: theme.font.semibold }}>
                  {money(order.total_kobo)}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={theme.textMuted}
                />
              </Pressable>
            ))
          ) : error ? (
            <ToolButton
              secondary
              label="Try again"
              onPress={() => void load()}
            />
          ) : (
            <EmptyResult
              title={
                tab === "All"
                  ? "No store orders yet"
                  : `No ${tab.toLowerCase()} orders`
              }
              body="Paid orders appear here so you can accept, prepare and hand them over."
            />
          )}
        </>
      )}
    </ToolPage>
  );
}
