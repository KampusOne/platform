import { CampusPlaceChoice } from "@/src/components/campus-place-choice";
import { useEffect, useState } from "react";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/lib/api";
import { Text, View } from "react-native";
import { BrandSwitch } from "@/src/components/brand-switch";
import { useAppearance } from "@/src/lib/appearance";
import { shareAgentLocation } from "@/src/lib/agent-location";
export default function StoreSettings() {
  const toast = useToast();
  const { theme } = useAppearance();
  const [fulfilmentReady, setFulfilmentReady] = useState(false),
    [pickupEnabled, setPickupEnabled] = useState(true),
    [selfDelivery, setSelfDelivery] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [phone, setPhone] = useState("");
  const [pickupPlace, setPickupPlace] = useState<string | null>(null);
  const [savedPickupPlace, setSavedPickupPlace] = useState<string | null>(null);
  const [pickup, setPickup] = useState("");
  const [vendorProfileId, setVendorProfileId] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState("");
  const [instructions, setInstructions] = useState("");
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{
      fulfilmentReady: boolean;
      storefront: {
        vendor_profile_id: string;
        display_name: string;
        description: string;
        contact_phone_e164: string;
        pickup_location: string;
        pickup_place_id?: string | null;
        pickup_instructions: string;
        opening_hours: Record<string, string>;
        pickup_enabled: boolean;
        self_delivery_enabled: boolean;
      } | null;
    }>("/v1/agents/storefront")
      .then(({ storefront: s, fulfilmentReady: ready }) => {
        setFulfilmentReady(ready);
        if (s) {
          setVendorProfileId(s.vendor_profile_id);
          setName(s.display_name);
          setDescription(s.description ?? "");
          setPhone(s.contact_phone_e164 ?? "");
          setPickup(s.pickup_location ?? "");
          setPickupPlace(s.pickup_place_id ?? null);
          setSavedPickupPlace(s.pickup_place_id ?? null);
          setInstructions(s.pickup_instructions ?? "");
          setHours(Object.values(s.opening_hours ?? {}).join("; "));
          if (ready) {
            setPickupEnabled(s.pickup_enabled);
            setSelfDelivery(s.self_delivery_enabled);
          }
        }
      })
      .catch((e) => toast(e.message, "error"));
  }, [toast]);
  async function sharePickupPosition() {
    if (busy || !vendorProfileId || !savedPickupPlace) return;
    setBusy(true);
    try {
      await shareAgentLocation(vendorProfileId);
      setLocationStatus("Your current pickup position is shared for 2 minutes. Refresh it while you are ready to meet the rider.");
      toast("Current pickup position shared", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Your pickup position could not be shared.", "error");
    } finally { setBusy(false); }
  }
  async function save(submit: boolean) {
    setBusy(true);
    try {
      const saved = await api<{vendor_profile_id:string}>("/v1/agents/storefront", {
        method: "PUT",
        body: JSON.stringify({
          displayName: name,
          description,
          contactPhoneE164: phone,
          pickupLocation: pickup,
          pickupPlaceId: pickupPlace,
          pickupInstructions: instructions,
          openingHours: { schedule: hours },
          defaultPreparationMinutes: 60,
        }),
      });
      setVendorProfileId(saved.vendor_profile_id);
      setSavedPickupPlace(pickupPlace);
      if (submit)
        await api("/v1/agents/storefront/status", {
          method: "PATCH",
          body: JSON.stringify({ status: "SUBMITTED" }),
        });
      toast(submit ? "Store submitted for review" : "Store saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save store", "error");
    } finally {
      setBusy(false);
    }
  }
  async function saveDelivery() {
    if (busy || !fulfilmentReady) return;
    setBusy(true);
    try {
      await api("/v1/agents/storefront/fulfilment", {
        method: "PUT",
        body: JSON.stringify({
          pickupEnabled,
          selfDeliveryEnabled: selfDelivery,
        }),
      });
      toast("Delivery options saved", "success");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Delivery options could not save.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage title="Store profile">
      <ToolField label="Store name" value={name} onChangeText={setName} />
      <ToolField
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <ToolField
        label="Contact phone (+234…)"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      <ToolField
        label="Vendor pickup address"
        value={pickup}
        onChangeText={setPickup}
      />
      <CampusPlaceChoice
        label="Approved store or agreed pickup point on the campus map"
        endpoint="/v1/agents/storefront"
        value={pickupPlace}
        onChange={setPickupPlace}
      />
      <Text style={{color:theme.textMuted,fontFamily:theme.font.body,lineHeight:21}}>
        Use your actual store location as the pickup address. If you meet riders at a campus entrance or another agreed point, select that sourced map point and explain the handoff below.
      </Text>
      <ToolField
        label="Pickup instructions"
        value={instructions}
        onChangeText={setInstructions}
        multiline
      />
      {vendorProfileId ? <View style={{gap:10,marginVertical:14,padding:16,backgroundColor:theme.surfaceMuted,borderRadius:14}}>
        <Text style={{color:theme.text,fontFamily:theme.font.semibold,fontSize:15}}>Ready for rider pickup?</Text>
        <Text style={{color:theme.textMuted,fontFamily:theme.font.body,lineHeight:21}}>Share your location while you are at the pickup point. Riders use this accurate position for 2 minutes, then routes use the approved store map point.</Text>
        {locationStatus ? <Text accessibilityRole="alert" style={{color:theme.textMuted,fontFamily:theme.font.body,lineHeight:21}}>{locationStatus}</Text> : null}
        {!savedPickupPlace ? <Text style={{color:theme.textMuted,fontFamily:theme.font.body,lineHeight:21}}>Save a sourced pickup map point first.</Text> : null}
        <ToolButton secondary label="Share current pickup position" disabled={busy || !savedPickupPlace} onPress={()=>void sharePickupPosition()}/>
      </View> : null}
      <ToolField
        label="Opening hours"
        value={hours}
        onChangeText={setHours}
        placeholder="Mon–Fri 8am–6pm, Sat 10am–4pm"
      />
      <ToolButton
        label="Save store"
        disabled={busy}
        onPress={() => void save(false)}
      />
      <ToolButton
        secondary
        label="Submit for review"
        disabled={busy}
        onPress={() => void save(true)}
      />
      <View
        style={{
          gap: 18,
          marginTop: 28,
          paddingTop: 20,
          borderTopWidth: 1,
          borderColor: theme.border,
        }}
      >
        <Text
          style={{
            color: theme.text,
            fontFamily: theme.font.semibold,
            fontSize: 18,
          }}
        >
          Delivery options
        </Text>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Text
            style={{ color: theme.text, fontFamily: theme.font.body, flex: 1 }}
          >
            Customers can pick up at your address
          </Text>
          <BrandSwitch
            label="Allow store pickup"
            value={pickupEnabled}
            onValueChange={setPickupEnabled}
            disabled={busy || !fulfilmentReady}
          />
        </View>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Text
            style={{ color: theme.text, fontFamily: theme.font.body, flex: 1 }}
          >
            I can deliver orders myself
          </Text>
          <BrandSwitch
            label="Offer vendor delivery"
            value={selfDelivery}
            onValueChange={setSelfDelivery}
            disabled={busy || !fulfilmentReady}
          />
        </View>
        <Text
          style={{
            color: theme.textMuted,
            fontFamily: theme.font.body,
            lineHeight: 21,
          }}
        >
          Pickup and vendor delivery currently have no delivery fee. For rider
          orders, post a request after marking the order ready.
        </Text>
        <ToolButton
          label="Save delivery options"
          disabled={busy || !fulfilmentReady}
          onPress={() => void saveDelivery()}
        />
      </View>
    </ToolPage>
  );
}
