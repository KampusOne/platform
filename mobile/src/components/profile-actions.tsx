import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { api, clearApiCache } from "@/src/lib/api";
import { useAppearance } from "@/src/lib/appearance";
import { useToast } from "./toast";

const reasons = ["I don’t want to see their posts", "Harassment or bullying", "Spam or misleading content", "Inappropriate content", "Other"];
export function ProfileActions({ userId, name, canBlock = true, notifications = false, onChanged }: {
  userId: string; name: string; canBlock?: boolean; notifications?: boolean; onChanged(): void;
}) {
  const { theme } = useAppearance();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"menu" | "block" | "report">("menu");
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const text = { color: theme.text, fontFamily: theme.font.body, fontSize: 14 };
  const close = () => { if (!busy) { setOpen(false); setAction("menu"); setReason(""); setDetails(""); } };
  async function submit() {
    if (busy || action === "menu" || (action === "report" && !reason)) return;
    setBusy(true);
    try {
      await api(`/v1/people/${userId}/${action}`, { method: action === "block" ? "PUT" : "POST", body: JSON.stringify({ ...(reason ? { reason } : {}), ...(details.trim() ? { details: details.trim() } : {}) }) });
      clearApiCache();
      setOpen(false);
      if (action === "block") { toast(`${name} blocked`, "success"); router.canGoBack() ? router.back() : router.replace("/(tabs)/feed"); }
      else toast("Report sent for review", "success");
      setAction("menu"); setReason(""); setDetails("");
    } catch (error) { toast(error instanceof Error ? error.message : "This action could not be completed.", "error"); }
    finally { setBusy(false); }
  }
  async function toggleNotifications() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/v1/people/${userId}/notifications`, { method: "PUT", body: JSON.stringify({ enabled: !notifications }) });
      setOpen(false); onChanged(); toast(notifications ? "Post notifications turned off" : "Post notifications turned on", "success");
    } catch (error) { toast(error instanceof Error ? error.message : "Notifications could not be updated.", "error"); }
    finally { setBusy(false); }
  }
  function row(label: string, icon: keyof typeof Ionicons.glyphMap, onPress: () => void) {
    return <Pressable accessibilityRole="button" disabled={busy} onPress={onPress} style={{ minHeight: 50, flexDirection: "row", gap: 12, alignItems: "center", opacity: busy ? 0.5 : 1 }}><Ionicons name={icon} size={21} color={theme.text} /><Text style={text}>{label}</Text></Pressable>;
  }
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`More options for ${name}`} onPress={() => setOpen(true)} style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface, borderRadius: 22 }}><Ionicons name="ellipsis-horizontal" size={23} color={theme.text} /></Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end", padding: 16 }}>
        <Pressable accessibilityLabel="Close profile options" onPress={close} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
        <ScrollView\n          keyboardShouldPersistTaps="handled"\n          showsVerticalScrollIndicator={action !== "menu"}\n          style={{ flexGrow: 0, flexShrink: 1, maxHeight: "85%", borderRadius: 20, backgroundColor: theme.surface }}\n          contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 22, paddingBottom: action === "menu" ? 18 : 28 }}\n        >
          <Text style={{ ...text, fontFamily: theme.font.semibold, fontSize: 19, marginBottom: 14 }}>{action === "menu" ? name : action === "block" ? `Block ${name}?` : `Report ${name}`}</Text>
          {action === "menu" ? <>
            {row(notifications ? "Turn off post notifications" : "Turn on post notifications", notifications ? "notifications-off-outline" : "notifications-outline", () => void toggleNotifications())}
            {row("Report profile", "flag-outline", () => setAction("report"))}
            {canBlock ? row("Block profile", "ban-outline", () => setAction("block")) : null}
          </> : <>
            <Text style={{ ...text, color: theme.textMuted, lineHeight: 21, marginBottom: 10 }}>{action === "block" ? "Their profile, posts and services will be hidden. You can unblock them in Settings. A reason is optional." : "Choose the reason for this report. Only the moderation team can review it."}</Text>
            {reasons.map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: reason === value }} onPress={() => setReason(value)} style={{ minHeight: 46, gap: 9, flexDirection: "row", alignItems: "center" }}><Ionicons name={reason === value ? "radio-button-on" : "radio-button-off"} size={22} color={reason === value ? theme.brand : theme.textMuted} /><Text style={{ ...text, flex: 1 }}>{value}</Text></Pressable>)}
            <TextInput accessibilityLabel="Additional details, optional" placeholder="Anything else? (optional)" placeholderTextColor={theme.textMuted} value={details} onChangeText={setDetails} multiline maxLength={1000} style={{ ...text, minHeight: 80, backgroundColor: theme.surfaceMuted, borderRadius: 10, padding: 12, marginVertical: 12 }} />
            <Pressable accessibilityRole="button" disabled={busy || (action === "report" && !reason)} onPress={() => void submit()} style={{ minHeight: 48, backgroundColor: theme.brand, borderRadius: 12, alignItems: "center", justifyContent: "center", opacity: busy || (action === "report" && !reason) ? 0.5 : 1 }}><Text style={{ ...text, color: "#FFFFFF", fontFamily: theme.font.semibold }}>{busy ? "Saving…" : action === "block" ? "Block profile" : "Send report"}</Text></Pressable>
          </>}
          {row("Cancel", "close-outline", close)}
        </ScrollView>
      </View>
    </Modal>
  </>;
}
