import { useEffect, useRef, useState } from "react";
import { AppState, Modal, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth/auth-context";
import { api } from "@/src/lib/api";
import { useAppearance } from "@/src/lib/appearance";
import { ToolButton } from "./toolkit";
import { useReducedMotionPreference } from "./visual-system";
type Reminder = {
  id: string;
  resource_type: "STORE_ORDER" | "TUTORIAL_BOOKING";
  resource_id: string;
  purchase_name: string;
};
export function PurchaseReviewPrompt() {
  const { user, profile } = useAuth(),
    { theme } = useAppearance(),
    path = usePathname();
  const reducedMotion = useReducedMotionPreference();
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const eligible =
    !!profile?.onboarding_completed_at &&
    !/conversation|payment|login|register|onboarding|order-detail/.test(path);
  const eligibility = useRef(eligible);
  eligibility.current = eligible;
  const showing = useRef(false);
  showing.current = !!reminder;
  useEffect(() => {
    setReminder(null);
    if (!user?.id || !profile?.university_id) return;
    let live = true,
      busy = false,
      shownThisSession = false;
    async function check() {
      if (
        !live ||
        busy ||
        shownThisSession ||
        showing.current ||
        !eligibility.current ||
        AppState.currentState !== "active"
      )
        return;
      busy = true;
      try {
        const result = await api<{ reminders: Reminder[] }>(
          "/v1/purchase-review-reminders",
        );
        if (!live || !eligibility.current) return;
        const next = result.reminders[0];
        if (!next) return;
        const claim = await api<{ claimed: boolean }>(
          `/v1/purchase-review-reminders/${next.id}/show`,
          { method: "POST" },
        );
        if (claim.claimed) {
          shownThisSession = true;
          if (live && eligibility.current) setReminder(next);
        }
      } catch {
        /* An optional review prompt never blocks the student's current task. */
      } finally {
        busy = false;
      }
    }
    const initial = setTimeout(() => void check(), 2500);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => {
      live = false;
      clearTimeout(initial);
      listener.remove();
    };
  }, [user?.id, profile?.university_id, profile?.onboarding_completed_at]);
  function dismiss() {
    const current = reminder;
    setReminder(null);
    if (current)
      void api(`/v1/purchase-review-reminders/${current.id}/dismiss`, {
        method: "POST",
      }).catch(() => undefined);
  }
  function review() {
    const current = reminder;
    setReminder(null);
    if (!current) return;
    if (current.resource_type === "STORE_ORDER")
      router.push({
        pathname: "/order-detail",
        params: { id: current.resource_id, review: "1" },
      });
    else router.push("/(tabs)/purchases");
  }
  return (
    <Modal
      transparent
      visible={!!reminder && eligible}
      animationType={reducedMotion ? "none" : "fade"}
      onRequestClose={() => setReminder(null)}
    >
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          padding: 24,
          backgroundColor: "rgba(41,35,31,0.45)",
        }}
      >
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: theme.surface,
            borderRadius: 20,
            padding: 24,
            gap: 16,
          }}
        >
          <Ionicons name="star-outline" size={32} color={theme.brand} />
          <Text
            style={{
              color: theme.text,
              fontFamily: theme.font.displayStrong,
              fontSize: 24,
            }}
          >
            How was {reminder?.purchase_name}?
          </Text>
          <Text
            style={{
              color: theme.textMuted,
              fontFamily: theme.font.body,
              lineHeight: 22,
            }}
          >
            Your purchase is complete. A rating can help other students,
            whenever you feel ready.
          </Text>
          <ToolButton label="Leave a review" onPress={review} />
          <ToolButton
            secondary
            label="Later"
            onPress={() => setReminder(null)}
          />
          <ToolButton secondary label="No thanks" onPress={dismiss} />
        </View>
      </View>
    </Modal>
  );
}
