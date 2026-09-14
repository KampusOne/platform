import { useEffect, useState } from "react";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/lib/api";
export default function StoreSettings() {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [phone, setPhone] = useState("");
  const [pickup, setPickup] = useState("");
  const [instructions, setInstructions] = useState("");
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{
      storefront: {
        display_name: string;
        description: string;
        contact_phone_e164: string;
        pickup_location: string;
        pickup_instructions: string;
        opening_hours: Record<string, string>;
      } | null;
    }>("/v1/agents/storefront")
      .then(({ storefront: s }) => {
        if (s) {
          setName(s.display_name);
          setDescription(s.description ?? "");
          setPhone(s.contact_phone_e164 ?? "");
          setPickup(s.pickup_location ?? "");
          setInstructions(s.pickup_instructions ?? "");
          setHours(Object.values(s.opening_hours ?? {}).join("; "));
        }
      })
      .catch((e) => toast(e.message, "error"));
  }, [toast]);
  async function save(submit: boolean) {
    setBusy(true);
    try {
      await api("/v1/agents/storefront", {
        method: "PUT",
        body: JSON.stringify({
          displayName: name,
          description,
          contactPhoneE164: phone,
          pickupLocation: pickup,
          pickupInstructions: instructions,
          openingHours: { schedule: hours },
          defaultPreparationMinutes: 60,
        }),
      });
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
        label="Pickup address"
        value={pickup}
        onChangeText={setPickup}
      />
      <ToolField
        label="Pickup instructions"
        value={instructions}
        onChangeText={setInstructions}
        multiline
      />
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
    </ToolPage>
  );
}
