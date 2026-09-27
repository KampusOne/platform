import { BrandSwitch } from "@/src/components/brand-switch";
import { useCallback, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Pressable, Text, View } from "react-native";
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
  store_name?:string;
  pickup_location?:string;
  delivery_note?:string;
  price_kobo?: number;
  rider_earning_kobo?: number;commission_kobo?:number;
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
  const [loadError,setLoadError]=useState("");
  const [rideTab,setRideTab]=useState<"AVAILABLE"|"ACTIVE"|"HISTORY">("AVAILABLE");
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
    setLoadError("");
  }, [role]);
  useFocusEffect(
    useCallback(() => {
      const refresh=()=>void load().catch((e) => {setLoadError(e.message);setReady(true);});
      refresh();
      const timer=role === "RIDER" ? setInterval(refresh,30_000) : undefined;
      return ()=>{if(timer)clearInterval(timer);};
    }, [load, role]),
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
            : role === "RIDER" ? "Available rides" : "Your workspaces"
      }
    >
      {caps.profiles.length>1&&<View style={{flexDirection:"row",gap:8,marginBottom:18}}>{caps.profiles.map(p=><Pressable key={p.id} accessibilityRole="tab" accessibilityState={{selected:role===p.agent_type}} onPress={()=>router.setParams({role:p.agent_type})} style={{padding:12,borderBottomWidth:2,borderColor:role===p.agent_type?theme.brand:"transparent"}}><Text style={{color:theme.text}}>{p.agent_type.toLowerCase()}</Text></Pressable>)}</View>}
      {(loadError||caps.error)&&<View style={{marginVertical:14}}><Text style={{color:theme.text}}>{loadError||caps.error}</Text><ToolButton secondary label="Try again" onPress={()=>void load().catch(e=>setLoadError(e.message))}/></View>}
      {caps.ready&&!role&&!caps.error&&<EmptyResult title="No approved role yet" body="Your workspaces appear here once your agent application is approved."/>}
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
      {role === "VENDOR" && <ToolRow title="Orders & delivery" icon="receipt-outline" onPress={()=>router.push("/vendor-orders")}/>}
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
            <BrandSwitch
              label="Go online"
              disabled={busy}
              value={online}
              onValueChange={(v) => void availability(v)}
            />
          }
        />
      ) : null}
      {role==="RIDER"&&<View style={{flexDirection:"row",gap:12,marginVertical:18}}>{(["AVAILABLE","ACTIVE","HISTORY"] as const).map(tab=><Pressable key={tab} accessibilityRole="tab" accessibilityState={{selected:rideTab===tab}} onPress={()=>setRideTab(tab)} style={{paddingVertical:10,borderBottomWidth:2,borderColor:tab===rideTab?theme.brand:"transparent"}}><Text style={{fontFamily:theme.font.semibold,color:theme.text}}>{tab==="AVAILABLE"?"Available":tab==="ACTIVE"?"Your deliveries":"History"}</Text></Pressable>)}</View>}
      {ready && !items.length && !loadError ? (
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
      {items.filter(item=>role!=="RIDER" || (rideTab === "AVAILABLE" ? item.status === "AVAILABLE" : rideTab === "ACTIVE" ? ["RESERVED","PICKED_UP"].includes(item.status) : !["AVAILABLE","RESERVED","PICKED_UP"].includes(item.status))).map((item) => (
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
            {item.store_name ?? item.name ?? item.title ?? item.zone_name}
          </Text>
          {role === "RIDER" && <View style={{gap:6,marginVertical:8}}><Text style={{color:theme.textMuted}}>Pickup · {item.pickup_location || item.zone_name || "Campus store"}</Text>{item.delivery_note&&<Text style={{color:theme.text}}>Delivery · {item.delivery_note}</Text>}</View>}
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
          {role === "RIDER" && item.commission_kobo!==undefined?<Text style={{color:theme.textMuted}}>Commission {money(item.commission_kobo)} · You receive {money(item.rider_earning_kobo??0)}</Text>:null}
          {role === "RIDER" && item.status === "AVAILABLE" ? (
            <ToolButton
              label="Accept delivery"
              disabled={busy || !online}
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
