import { CampusPlaceChoice, type CampusPlace } from "@/src/components/campus-place-choice";
import { useEffect, useRef, useState } from "react";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/lib/api";
import { Text, View } from "react-native";
import { BrandSwitch } from "@/src/components/brand-switch";
import { useAppearance } from "@/src/lib/appearance";
import { shareAgentLocation } from "@/src/lib/agent-location";
import { HeaderMenu } from "@/src/components/header-menu";
import { useAuth } from "@/src/auth/auth-context";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { storefrontInput, storefrontHours } from '@/src/lib/storefront-input';
import { cacheScopeForUser } from '@/src/lib/request-policy';
export default function StoreSettings() {
  const { user } = useAuth();
  return <StoreForm key={user ? cacheScopeForUser(user) : 'anonymous'} />;
}
function StoreForm() {
  const toast = useToast();
  const { theme } = useAppearance();
  const [fulfilmentReady, setFulfilmentReady] = useState(false),
    [pickupEnabled, setPickupEnabled] = useState(true);
  const [pickupPoints, setPickupPoints] = useState<CampusPlace[]>([]);
  const [preparationMinutes, setPreparationMinutes] = useState(60);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const saveLock = useRef(false);
  const [storeStatus, setStoreStatus] = useState('DRAFT');
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [phone, setPhone] = useState("");
  const [pickupPlace, setPickupPlace] = useState<string | null>(null);
  const [savedPickupPlace, setSavedPickupPlace] = useState<string | null>(null);
  const [pickup, setPickup] = useState("");
  const [pickupLocations,setPickupLocations]=useState("");
  const [vendorProfileId, setVendorProfileId] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState("");
  const [instructions, setInstructions] = useState("");
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true; const controller = new AbortController(); setLoading(true); setLoadError("");
    void api<{
      fulfilmentReady: boolean;
      vendorProfileId?: string;
      pickupPoints: CampusPlace[];
      storefront: {
        vendor_profile_id: string;
        status: string;
        display_name: string;
        description: string;
        contact_phone_e164: string;
        pickup_location: string;
        pickup_locations?:string[];
        pickup_place_id?: string | null;
        pickup_instructions: string;
        opening_hours: Record<string, unknown>;
        default_preparation_minutes: number;
        pickup_enabled: boolean;
        self_delivery_enabled: boolean;
      } | null;
    }>("/v1/agents/storefront", { cache: "reload", signal: controller.signal })
      .then(({ storefront: s, fulfilmentReady: ready, pickupPoints: points, vendorProfileId: profileId }) => {
        if (!active) return;
        setFulfilmentReady(ready);
        setPickupPoints(points ?? []);
        setVendorProfileId(profileId ?? s?.vendor_profile_id ?? null);
        if (s) {
          setVendorProfileId(s.vendor_profile_id);
          setName(s.display_name);
          setStoreStatus(s.status);
          setDescription(s.description ?? "");
          setPhone(s.contact_phone_e164 ?? "");
          setPickup(s.pickup_location ?? "");
          setPickupLocations((s.pickup_locations??[]).filter(x=>x!==s.pickup_location).join("\n"));
          setPickupPlace(s.pickup_place_id ?? null);
          setSavedPickupPlace(s.pickup_place_id ?? null);
          setInstructions(s.pickup_instructions ?? "");
          setHours(storefrontHours(s.opening_hours ?? {}));
          setPreparationMinutes(s.default_preparation_minutes ?? 60);
          if (ready) {
            setPickupEnabled(s.pickup_enabled);
          }
        }
      })
      .catch((e) => active && setLoadError(e instanceof Error ? e.message : "Your store could not load."))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [reload]);
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
    if (saveLock.current || loading || loadError) return;
    const { payload, errors } = storefrontInput({ name, description, phone, pickup,
      additionalLocations: pickupLocations, pickupPlace, instructions, hours, preparationMinutes }, submit);
    setFieldErrors(errors); setSaveError('');
    if (Object.keys(errors).length) return;
    saveLock.current = true; setBusy(true);
    let detailsSaved = false;
    try {
      const saved = await api<{vendor_profile_id:string; status:string}>("/v1/agents/storefront", {
        method: "PUT", body: JSON.stringify(payload),
      });
      detailsSaved = true; setStoreStatus(saved.status);
      setVendorProfileId(saved.vendor_profile_id); setSavedPickupPlace(pickupPlace); setPhone(payload.contactPhoneE164);
      if (fulfilmentReady) await api("/v1/agents/storefront/fulfilment", {
        method: "PUT", body: JSON.stringify({ pickupEnabled, selfDeliveryEnabled: false }),
      });
      if (submit) await api("/v1/agents/storefront/status", { method: "PATCH", body: JSON.stringify({ status: "SUBMITTED" }) });
      toast(submit ? "Store submitted for review" : "Store saved", "success");
    } catch (e) {
      const message = (detailsSaved ? 'Store details saved. ' : '') + (e instanceof Error ? e.message : "Could not save store");
      setSaveError(message); toast(message, "error");
    } finally { saveLock.current = false; setBusy(false); }
  }
  function fieldError(field: string) {
    return fieldErrors[field] ? <Text accessibilityRole="alert" style={{color: theme.error, fontFamily: theme.font.body, marginBottom: 10}}>{fieldErrors[field]}</Text> : null;
  }
  return (
    <ToolPage title="Store profile" action={<HeaderMenu label="Store options" items={[
      { label: "Refresh store", icon: "refresh-outline", onPress: () => setReload(value => value + 1), disabled: busy || loading },
      ...(['DRAFT', 'NEEDS_CORRECTION'].includes(storeStatus) ? [{ label: "Submit for review", icon: "checkmark-circle-outline" as const, onPress: () => void save(true), disabled: busy || loading || Boolean(loadError) }] : []),
      { label: "Share current pickup position", icon: "locate-outline", onPress: () => void sharePickupPosition(), disabled: busy || !vendorProfileId || !savedPickupPlace },
    ]} />}>
      {loading ? <ScreenSkeleton variant="list" compact /> : loadError ? <Text accessibilityRole="alert" style={{ color: theme.error }}>{loadError}</Text> : <>
      <ToolField label="Store name" value={name} onChangeText={setName} editable={!busy} />
      {fieldError('name')}
      <ToolField
        label="Description"
        value={description}
        onChangeText={setDescription} editable={!busy}
        multiline
      />
      {fieldError('description')}
      <ToolField
        label="Contact phone (+234…)"
        value={phone}
        onChangeText={setPhone} editable={!busy}
        keyboardType="phone-pad"
      />
      {fieldError('phone')}
      <ToolField
        label="Vendor pickup address"
        value={pickup}
        onChangeText={setPickup} editable={!busy}
      />
      {fieldError('pickup')}
      <ToolField label="Additional buyer pickup locations (one per line)" value={pickupLocations} onChangeText={setPickupLocations} editable={!busy} multiline placeholder="Faculty entrance\nLibrary meeting point"/>
      {fieldError('additionalLocations')}
      <Text style={{color:theme.textMuted,fontFamily:theme.font.body,lineHeight:21}}>Save your pickup address and a map location before uploading products. Your saved store location stays available for riders.</Text>
      <CampusPlaceChoice
        options={pickupPoints} disabled={busy}
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
        onChangeText={setInstructions} editable={!busy}
        multiline
      />
      {fieldError('instructions')}
      {vendorProfileId ? <View style={{gap:10,marginVertical:14,padding:16,backgroundColor:theme.surfaceMuted,borderRadius:14}}>
        <Text style={{color:theme.text,fontFamily:theme.font.semibold,fontSize:15}}>Ready for rider pickup?</Text>
        <Text style={{color:theme.textMuted,fontFamily:theme.font.body,lineHeight:21}}>Share your location while you are at the pickup point. Riders use this accurate position for 2 minutes, then routes use the approved store map point.</Text>
        {locationStatus ? <Text accessibilityRole="alert" style={{color:theme.textMuted,fontFamily:theme.font.body,lineHeight:21}}>{locationStatus}</Text> : null}
        {!savedPickupPlace ? <Text style={{color:theme.textMuted,fontFamily:theme.font.body,lineHeight:21}}>Save a sourced pickup map point first.</Text> : null}
      </View> : null}
      <ToolField
        label="Opening hours (optional)"
        value={hours}
        onChangeText={setHours} editable={!busy}
        placeholder="Mon–Fri 8am–6pm, Sat 10am–4pm"
      />
      {fieldError('hours')}
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
        <Text
          style={{
            color: theme.textMuted,
            fontFamily: theme.font.body,
            lineHeight: 21,
          }}
        >
          Customers can choose pickup or rider delivery. Mark an order ready before requesting a rider.
        </Text>
        {!fulfilmentReady ? <Text accessibilityRole="alert" style={{ color: theme.error }}>Delivery options could not load. Reopen your store profile to try again.</Text> : null}
        {saveError ? <Text accessibilityRole="alert" style={{ color: theme.error }}>{saveError}</Text> : null}
        <ToolButton label={busy ? "Saving store…" : "Save store"} disabled={busy} onPress={() => void save(false)} />
      </View>
      </>}
    </ToolPage>
  );
}
