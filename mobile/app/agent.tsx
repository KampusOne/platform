import {shareAgentLocation} from '@/src/lib/agent-location';
import { BrandSwitch } from "@/src/components/brand-switch";
import { useCallback, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { AppState, Linking, Pressable, Text, View } from "react-native";
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
import { useAuth } from "@/src/auth/auth-context";
import { HeaderMenu } from "@/src/components/header-menu";
import { ScreenSkeleton } from "@/src/components/skeleton";
type Item = {
  id: string;
  title?: string;
  name?: string;
  zone_name?: string;
  store_name?: string;
  vendor_name?: string;
  vendor_user_id?: string;
  vendor_phone?: string | null;
  vendor_whatsapp?: string | null;
  delivery_location?: string | null;
  pickup_location?: string;
  delivery_note?: string;
  price_kobo?: number;
  rider_earning_kobo?: number;
  commission_kobo?: number;
  fare_kobo?: number;
  fare_payment_method?: "IN_APP" | "CASH";
  status: string;
};
const money = (value: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    value / 100,
  );
export default function AgentDashboard() {
  const { user } = useAuth();
  return <AccountAgentDashboard key={user?.id ?? "anonymous"} />;
}
function AccountAgentDashboard() {
  const { role: requested } = useLocalSearchParams<{ role?: string }>();
  const caps = useCapabilities();
  const profile =
    caps.profiles.find((p) => p.agent_type === requested) ?? caps.profiles[0];
  const role = profile?.agent_type;
  const seller = role === "VENDOR" || requested === "VENDOR";
  const { theme } = useAppearance();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [rideTab, setRideTab] = useState<"AVAILABLE" | "ACTIVE" | "HISTORY">(
    "AVAILABLE",
  );
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locationStatus,setLocationStatus]=useState("Share your current location for delivery routes.");
  const [code, setCode] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);
  const [ridesSuspended, setRidesSuspended] = useState(false);
  const load = useCallback(async () => {
    if (!role) return;
    const r = await api<{
      products?: Item[];
      listings?: Item[];
      jobs?: Item[];
      presence?: { online: boolean };
      finance?: { rides_suspended: boolean } | null;
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
    setRidesSuspended(r.finance?.rides_suspended ?? false);
    setReady(true);
    setLoadError("");
  }, [role]);
  useFocusEffect(
    useCallback(() => {
      const refresh = () =>
        void load().catch((e) => {
          setLoadError(e.message);
          setReady(true);
        });
      refresh();
      const timer = role === "RIDER" ? setInterval(refresh, 30_000) : undefined;
      return () => {
        if (timer) clearInterval(timer);
      };
    }, [load, role]),
  );
  useFocusEffect(useCallback(()=>{
    if(role!=='RIDER'||!online||!profile?.id)return;
    let active=true,pending=false;
    const refresh=async()=>{if(!active||pending||AppState.currentState!=='active')return;pending=true;try{await shareAgentLocation(profile.id,false);if(active)setLocationStatus('Current location shared while this screen is open.');}catch(e){if(active)setLocationStatus(e instanceof Error?e.message:'Refresh your location for rider routes.');}finally{pending=false;}};
    void refresh();const timer=setInterval(()=>void refresh(),30000);return()=>{active=false;clearInterval(timer);};
  },[role,online,profile?.id]));
  async function refreshPosition(){if(!profile)return;setBusy(true);try{await shareAgentLocation(profile.id);setLocationStatus('Current location shared for delivery routes.');}catch(e){toast(e instanceof Error?e.message:'Location could not refresh.','error');}finally{setBusy(false);}}
  async function reviewPickup(item:Item){setBusy(true);try{if(!profile)return;await shareAgentLocation(profile.id);router.push({pathname:'/delivery-route',params:{jobId:item.id}});}catch(e){toast(e instanceof Error?e.message:'Pickup route could not be reviewed.','error');}finally{setBusy(false);}}

  async function action(item: Item, type: string) {
    setBusy(true);
    try {
      if(type==="reserve"&&profile)await shareAgentLocation(profile.id);
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
      if(value&&profile)await shareAgentLocation(profile.id);
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
        seller
          ? "Seller dashboard"
          : role === "TUTOR"
            ? "Tutor dashboard"
            : role === "RIDER"
              ? "Available rides"
              : "Your workspaces"
      }
      action={seller ? <HeaderMenu label="Seller dashboard options" items={[
        { label: "Store profile", icon: "storefront-outline", onPress: () => router.push("/store-settings"), disabled: !profile },
        { label: "Orders & delivery", icon: "receipt-outline", onPress: () => router.push("/vendor-orders"), disabled: !profile },
        { label: "Earnings & payouts", icon: "wallet-outline", onPress: () => router.push("/earnings"), disabled: !profile },
        { label: "Seller trial", icon: "gift-outline", onPress: () => router.push("/trial"), disabled: !profile },
        { label: "View seller profile", icon: "person-circle-outline", onPress: () => profile && router.push({ pathname: "/student-service", params: { id: profile.id } }), disabled: !profile },
        { label: "Refresh dashboard", icon: "refresh-outline", onPress: () => void load().catch(e => setLoadError(e.message)), disabled: !profile || busy },
        { label: "Refresh delivery location", icon: "locate-outline", onPress: () => void refreshPosition(), disabled: !profile || busy },
        { label: "Campus capture missions", icon: "map-outline", onPress: () => router.push("/map-capture"), disabled: !profile },
      ]} /> : undefined}
    >
      {!caps.ready ? <ScreenSkeleton variant="list" compact /> : <>
      {seller && profile ? <View style={{ gap: 5, paddingVertical: 14 }}><Text style={{ color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 23 }}>{profile.display_name}</Text><Text style={{ color: theme.textMuted, fontFamily: theme.font.body }}>Manage your products and sales.</Text></View> : null}
      {!seller && caps.profiles.length>0?<ToolButton secondary label="Campus capture missions" onPress={()=>router.push("/map-capture")}/>:null}
      {caps.profiles.length > 1 && (
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 18 }}>
          {caps.profiles.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: role === p.agent_type }}
              onPress={() => router.setParams({ role: p.agent_type })}
              style={{
                padding: 12,
                borderBottomWidth: 2,
                borderColor:
                  role === p.agent_type ? theme.brand : "transparent",
              }}
            >
              <Text style={{ color: theme.text }}>
                {p.agent_type.toLowerCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {(loadError || caps.error) && (
        <View style={{ marginVertical: 14 }}>
          <Text style={{ color: theme.text }}>{loadError || caps.error}</Text>
          <ToolButton
            secondary
            label="Try again"
            onPress={() => void load().catch((e) => setLoadError(e.message))}
          />
        </View>
      )}
      {caps.ready && !role && !caps.error && (
        <EmptyResult
          title="No approved role yet"
          body="Your workspaces appear here once your agent application is approved."
        />
      )}
      {!seller && profile ? (
        <ToolRow
          title={`View ${profile.agent_type === "VENDOR" ? "Vendor" : profile.agent_type === "TUTOR" ? "Tutor" : "Rider"} Profile`}
          detail={profile.display_name}
          icon="person-circle-outline"
          onPress={() =>
            router.push({
              pathname: "/student-service",
              params: { id: profile.id },
            })
          }
        />
      ) : null}
      {!seller ? <ToolRow
        title="Earnings & payouts"
        icon="wallet-outline"
        onPress={() => router.push("/earnings")}
      /> : null}
      {role === "RIDER" && ridesSuspended ? (
        <View style={{ paddingVertical: 16 }}>
          <Text style={{ color: theme.text, fontFamily: theme.font.semibold }}>
            Four ride commissions are unpaid. Pay your commission to accept
            another ride.
          </Text>
          <ToolButton
            label="Pay your commission"
            onPress={() => router.push("/earnings")}
          />
        </View>
      ) : null}
      {!seller ? <ToolRow
        title="Free trial"
        icon="gift-outline"
        onPress={() => router.push("/trial")}
      /> : null}
      {role && role !== "RIDER" ? (
        <ToolButton
          label={role === "VENDOR" ? "Create product" : "Create tutorial"}
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
              disabled={busy || ridesSuspended}
              value={online}
              onValueChange={(v) => void availability(v)}
            />
          }
        />
      ) : null}
      {role==='RIDER'?<View style={{gap:8,marginVertical:12}}><ToolButton secondary disabled={busy} label="Refresh delivery location" onPress={()=>void refreshPosition()}/><Text style={{color:theme.textMuted,fontFamily:theme.font.body,fontSize:12}}>{locationStatus}</Text></View>:null}
      {role === "RIDER" && (
        <View style={{ flexDirection: "row", gap: 12, marginVertical: 18 }}>
          {(["AVAILABLE", "ACTIVE", "HISTORY"] as const).map((tab) => (
            <Pressable
              key={tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: rideTab === tab }}
              onPress={() => setRideTab(tab)}
              style={{
                paddingVertical: 10,
                borderBottomWidth: 2,
                borderColor: tab === rideTab ? theme.brand : "transparent",
              }}
            >
              <Text
                style={{ fontFamily: theme.font.semibold, color: theme.text }}
              >
                {tab === "AVAILABLE"
                  ? "Available"
                  : tab === "ACTIVE"
                    ? "Your deliveries"
                    : "History"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {role==='RIDER'&&rideTab==='AVAILABLE'?items.filter(i=>i.status==='AVAILABLE').map(i=><ToolButton key={'route-'+i.id} secondary disabled={busy} label={`Review pickup route · ${i.vendor_name??i.pickup_location??i.zone_name??'Available ride'}`} onPress={()=>void reviewPickup(i)}/>):null}
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
      {items
        .filter(
          (item) =>
            role !== "RIDER" ||
            (rideTab === "AVAILABLE"
              ? item.status === "AVAILABLE"
              : rideTab === "ACTIVE"
                ? ["RESERVED", "PICKED_UP"].includes(item.status)
                : !["AVAILABLE", "RESERVED", "PICKED_UP"].includes(
                    item.status,
                  )),
        )
        .map((item) => (
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
              {item.vendor_name ??
                item.store_name ??
                item.name ??
                item.title ??
                item.zone_name}
            </Text>
            {role === "RIDER" && (
              <View style={{ gap: 6, marginVertical: 8 }}>
                <Text style={{ color: theme.textMuted }}>
                  Pickup ·{" "}
                  {item.pickup_location || item.zone_name || "Campus store"}
                </Text>
                {item.delivery_note && (
                  <Text style={{ color: theme.text }}>
                    Delivery · {item.delivery_note}
                  </Text>
                )}
              </View>
            )}
            {role === "RIDER" && item.delivery_location ? (
              <Text style={{ color: theme.text, marginBottom: 12 }}>
                Drop-off · {item.delivery_location}
              </Text>
            ) : null}
            {role === "RIDER" &&
            ["RESERVED", "PICKED_UP"].includes(item.status) ? (
              <View style={{ gap: 8, marginVertical: 10 }}>
                {item.vendor_user_id ? (
                  <ToolButton
                    secondary
                    label="Message vendor"
                    disabled={busy}
                    onPress={() => {
                      void api<{ thread: { id: string } }>(
                        "/v1/messages/threads",
                        {
                          method: "POST",
                          body: JSON.stringify({ userId: item.vendor_user_id }),
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
                ) : null}
                {item.vendor_phone ? (
                  <ToolButton
                    secondary
                    label="Call vendor"
                    onPress={() => {
                      void Linking.openURL(`tel:${item.vendor_phone}`).catch(
                        () => toast("Calling could not open.", "error"),
                      );
                    }}
                  />
                ) : null}
                {item.vendor_whatsapp ? (
                  <ToolButton
                    secondary
                    label="WhatsApp vendor"
                    onPress={() => {
                      void Linking.openURL(
                        `https://wa.me/${item.vendor_whatsapp!.replace(/\D/g, "")}`,
                      ).catch(() => toast("WhatsApp could not open.", "error"));
                    }}
                  />
                ) : null}
              </View>
            ) : null}
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
            {role === "RIDER" && item.commission_kobo != null ? (
              <Text style={{ color: theme.textMuted }}>
                Fare {money(item.fare_kobo ?? 0)} ·{" "}
                {item.fare_payment_method === "CASH"
                  ? "Collect cash"
                  : "Paid in app"}{" "}
                · Commission {money(item.commission_kobo)} · You receive{" "}
                {money(item.rider_earning_kobo ?? 0)}
              </Text>
            ) : null}
            {role === "RIDER" && item.status === "AVAILABLE" ? (
              <ToolButton
                label="Accept delivery"
                disabled={busy || !online || ridesSuspended}
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
      </>}
    </ToolPage>
  );
}
