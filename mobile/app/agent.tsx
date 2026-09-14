import { useCallback, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Switch, Text, View } from "react-native";
import {
  ToolPage,
  ToolButton,
  ToolRow,
  ToolField,
} from "@/src/components/toolkit";
import { EmptyResult } from "@/src/components/product-ui";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { useCapabilities } from "@/src/components/agent-shortcuts";
import { api } from "@/src/lib/api";
type Item = {
  id: string;
  title?: string;
  name?: string;
  zone_name?: string;
  price_kobo?: number;
  rider_earning_kobo?: number;
  status: string;
};
const money = (value: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    value / 100,
  );
export default function AgentDashboard() {
  const { role: requested } = useLocalSearchParams<{ role?: string }>();
  const caps = useCapabilities();
  const profile =
    caps.profiles.find((p) => p.agent_type === requested) ?? caps.profiles[0];
  const role = profile?.agent_type;
  const { theme } = useAppearance();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);
  const load = useCallback(async () => {
    if (!role) return;
    const r = await api<{
      products?: Item[];
      listings?: Item[];
      jobs?: Item[];
      presence?: { online: boolean };
    }>(
      "/v1/agents/" +
        (role === "VENDOR"
          ? "products"
          : role === "TUTOR"
            ? "tutorials"
            : "deliveries"),
    );
    setItems(r.products ?? r.listings ?? r.jobs ?? []);
    setOnline(r.presence?.online ?? false);
    setReady(true);
  }, [role]);
  useFocusEffect(
    useCallback(() => {
      void load().catch((e) => toast(e.message, "error"));
    }, [load, toast]),
  );
  async function action(item: Item, type: string) {
    setBusy(true);
    try {
      await api("/v1/agents/deliveries/" + item.id + "/" + type, {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setSelected(null);
      setCode("");
      await load();
      toast("Delivery updated", "success");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Could not update delivery",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  async function availability(value: boolean) {
    setBusy(true);
    try {
      await api("/v1/agents/rider-presence", {
        method: "PUT",
        body: JSON.stringify({ online: value, capacityStatus: "AVAILABLE" }),
      });
      setOnline(value);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Could not update availability",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage
      title={
        role === "VENDOR"
          ? "Seller dashboard"
          : role === "TUTOR"
            ? "Tutor dashboard"
            : "Rider dashboard"
      }
    >
      <ToolRow
        title="Earnings & payouts"
        icon="wallet-outline"
        onPress={() => router.push("/earnings")}
      />
      <ToolRow
        title="Free trial"
        icon="gift-outline"
        onPress={() => router.push("/trial")}
      />
      {role === "VENDOR" ? (
        <ToolRow
          title="Store profile"
          icon="storefront-outline"
          onPress={() => router.push("/store-settings")}
        />
      ) : null}
      {role && role !== "RIDER" ? (
        <ToolButton
          label={role === "VENDOR" ? "Add product" : "Create tutorial"}
          onPress={() =>
            router.push({ pathname: "/agent-create", params: { role } })
          }
        />
      ) : role === "RIDER" ? (
        <ToolRow
          title="Available for deliveries"
          trailing={
            <Switch
              accessibilityLabel="Go online"
              disabled={busy}
              value={online}
              onValueChange={(v) => void availability(v)}
            />
          }
        />
      ) : null}
      {ready && !items.length ? (
        <EmptyResult
          title={
            role === "RIDER"
              ? "No delivery requests"
              : role === "TUTOR"
                ? "No tutorials yet"
                : "No products yet"
          }
        />
      ) : null}
      {items.map((item) => (
        <View
          key={item.id}
          style={{
            paddingVertical: 18,
            borderBottomWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Text
            style={{
              fontFamily: theme.font.semibold,
              color: theme.text,
              fontSize: 17,
            }}
          >
            {item.name ?? item.title ?? item.zone_name}
          </Text>
          {role === "TUTOR" ? (
            <ToolButton
              secondary
              label="Manage tutorial"
              onPress={() =>
                router.push({
                  pathname: "/tutorial-manage",
                  params: { id: item.id },
                })
              }
            />
          ) : null}
          <Text
            style={{
              fontFamily: theme.font.body,
              color: theme.textMuted,
              marginVertical: 8,
            }}
          >
            {item.status.replaceAll("_", " ")}
            {item.price_kobo !== undefined ||
            item.rider_earning_kobo !== undefined
              ? " · " +
                money(Number(item.price_kobo ?? item.rider_earning_kobo ?? 0))
              : ""}
          </Text>
          {role === "RIDER" && item.status === "AVAILABLE" ? (
            <ToolButton
              label="Accept delivery"
              disabled={busy}
              onPress={() => void action(item, "reserve")}
            />
          ) : null}
          {role === "RIDER" &&
          ["RESERVED", "PICKED_UP"].includes(item.status) ? (
            <ToolButton
              secondary
              label={
                item.status === "RESERVED"
                  ? "Confirm pickup"
                  : "Complete delivery"
              }
              disabled={busy}
              onPress={() => setSelected(item)}
            />
          ) : null}
        </View>
      ))}
      {selected ? (
        <View style={{ marginVertical: 20 }}>
          <ToolField
            label={
              selected.status === "RESERVED" ? "Pickup code" : "Delivery code"
            }
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
          />
          <ToolButton
            label="Confirm"
            disabled={busy || code.length !== 6}
            onPress={() =>
              void action(
                selected,
                selected.status === "RESERVED" ? "pickup" : "complete",
              )
            }
          />
        </View>
      ) : null}
    </ToolPage>
  );
}
