import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, clearApiCache } from "@/src/lib/api";
import { useAppearance } from "@/src/lib/appearance";
import { useToast } from "./toast";

const reasons = ["I don’t want to see their posts", "Harassment or bullying", "Spam or misleading content", "Inappropriate content", "Other"];

export function ProfileActions({ userId, name, canBlock = true, notifications = false, onChanged }: {
  userId: string; name: string; canBlock?: boolean; notifications?: boolean; onChanged(): void;
}) {
  const { theme } = useAppearance();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"menu" | "block" | "report">("menu");
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  const text = { color: theme.text, fontFamily: theme.font.body, fontSize: 14 };
  const close = () => {
    if (!busy) {
      setOpen(false);
      setAction("menu");
      setReason("");
      setDetails("");
    }
  };

  async function submit() {
    if (busy || action === "menu" || (action === "report" && !reason)) return;
    setBusy(true);
    try {
      await api(`/v1/people/${userId}/${action}`, {
        method: action === "block" ? "PUT" : "POST",
        body: JSON.stringify({
          ...(reason ? { reason } : {}),
          ...(details.trim() ? { details: details.trim() } : {}),
        }),
      });
      clearApiCache();
      setOpen(false);
      if (action === "block") {
        toast(`${name} blocked`, "success");
        router.canGoBack() ? router.back() : router.replace("/(tabs)/feed");
      } else {
        toast("Report sent for review", "success");
      }
      setAction("menu");
      setReason("");
      setDetails("");
    } catch (error) {
      toast(error instanceof Error ? error.message : "This action could not be completed.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleNotifications() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/v1/people/${userId}/notifications`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !notifications }),
      });
      setOpen(false);
      onChanged();
      toast(notifications ? "Post notifications turned off" : "Post notifications turned on", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Notifications could not be updated.", "error");
    } finally {
      setBusy(false);
    }
  }

  function row(label: string, icon: keyof typeof Ionicons.glyphMap, onPress: () => void) {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onPress}
        style={({ pressed }) => [styles.row, busy && styles.disabled, pressed && styles.pressed]}
      >
        <Ionicons name={icon} size={21} color={theme.text} />
        <Text style={[text, styles.rowLabel]}>{label}</Text>
      </Pressable>
    );
  }

  const bottomPadding = Math.max(16, insets.bottom + 8);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`More options for ${name}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, { backgroundColor: theme.surface }, pressed && styles.pressed]}
      >
        <Ionicons name="ellipsis-horizontal" size={23} color={theme.text} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.overlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close profile options"
            onPress={close}
            style={StyleSheet.absoluteFill}
          />

          {action === "menu" ? (
            <View
              accessibilityViewIsModal
              style={[
                styles.sheet,
                styles.menuSheet,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                  paddingBottom: bottomPadding,
                },
              ]}
            >
              <Text style={[text, styles.title, { fontFamily: theme.font.semibold }]}>{name}</Text>
              {row(
                notifications ? "Turn off post notifications" : "Turn on post notifications",
                notifications ? "notifications-off-outline" : "notifications-outline",
                () => void toggleNotifications(),
              )}
              {row("Report profile", "flag-outline", () => setAction("report"))}
              {canBlock ? row("Block profile", "ban-outline", () => setAction("block")) : null}
              {row("Cancel", "close-outline", close)}
            </View>
          ) : (
            <View
              accessibilityViewIsModal
              style={[
                styles.sheet,
                styles.formSheet,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={styles.formScroll}
                contentContainerStyle={[styles.formContent, { paddingBottom: bottomPadding }]}
                showsVerticalScrollIndicator={false}
              >
                <Text style={[text, styles.title, { fontFamily: theme.font.semibold }]}>
                  {action === "block" ? `Block ${name}?` : `Report ${name}`}
                </Text>
                <Text style={[text, styles.description, { color: theme.textMuted }]}>
                  {action === "block"
                    ? "Their profile, posts and services will be hidden. You can unblock them in Settings. A reason is optional."
                    : "Choose the reason for this report. Only the moderation team can review it."}
                </Text>

                {reasons.map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: reason === value }}
                    onPress={() => setReason(value)}
                    style={({ pressed }) => [styles.reasonRow, pressed && styles.pressed]}
                  >
                    <Ionicons
                      name={reason === value ? "radio-button-on" : "radio-button-off"}
                      size={22}
                      color={reason === value ? theme.brand : theme.textMuted}
                    />
                    <Text style={[text, styles.reasonLabel]}>{value}</Text>
                  </Pressable>
                ))}

                <TextInput
                  accessibilityLabel="Additional details, optional"
                  placeholder="Anything else? (optional)"
                  placeholderTextColor={theme.textMuted}
                  value={details}
                  onChangeText={setDetails}
                  multiline
                  maxLength={1000}
                  style={[
                    text,
                    styles.details,
                    {
                      backgroundColor: theme.surfaceMuted,
                      borderColor: theme.border,
                    },
                  ]}
                />

                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy || (action === "report" && !reason), busy }}
                  disabled={busy || (action === "report" && !reason)}
                  onPress={() => void submit()}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: theme.brand },
                    (busy || (action === "report" && !reason)) && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[text, styles.primaryButtonText, { fontFamily: theme.font.semibold }]}>
                    {busy ? "Saving…" : action === "block" ? "Block profile" : "Send report"}
                  </Text>
                </Pressable>

                {row("Cancel", "close-outline", close)}
              </ScrollView>
            </View>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 42,
    height: 42,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  sheet: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  menuSheet: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  formSheet: {
    maxHeight: "82%",
  },
  formScroll: {
    flexGrow: 0,
  },
  formContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  title: {
    fontSize: 19,
    marginBottom: 10,
  },
  row: {
    minHeight: 50,
    flexDirection: "row",
    gap: 13,
    alignItems: "center",
    paddingVertical: 8,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
  },
  description: {
    lineHeight: 21,
    marginBottom: 10,
  },
  reasonRow: {
    minHeight: 46,
    gap: 9,
    flexDirection: "row",
    alignItems: "center",
  },
  reasonLabel: {
    flex: 1,
  },
  details: {
    minHeight: 88,
    maxHeight: 160,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginVertical: 12,
    textAlignVertical: "top",
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.68,
  },
});
