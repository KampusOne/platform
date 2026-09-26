import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { scheduleAlarmSnooze } from "@/src/lib/alarms";
import { useAppearance, type Theme } from "@/src/lib/appearance";
import * as Haptics from "@/src/lib/haptics";

const RING_WINDOW_SECONDS = 180;

function formatClock(value?: string) {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return new Intl.DateTimeFormat("en-NG", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());
  }
  const [hour, minute] = value.split(":").map(Number);
  const period = hour! >= 12 ? "PM" : "AM";
  const h = hour! % 12 || 12;
  return `${h}:${String(minute).padStart(2, "0")} ${period}`;
}

export default function AlarmRingScreen() {
  const { theme } = useAppearance();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const params = useLocalSearchParams<{
    alarmId?: string;
    label?: string;
    time?: string;
    snoozeMinutes?: string;
    notificationId?: string;
  }>();
  const [remaining, setRemaining] = useState(RING_WINDOW_SECONDS);
  const pulse = useRef(new Animated.Value(0)).current;
  const alarmId = String(params.alarmId ?? "");
  const label = String(params.label ?? "Alarm");
  const snoozeMinutes = Math.max(1, Math.min(30, Number(params.snoozeMinutes) || 5));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          clearInterval(timer);
          router.replace("/alarms" as never);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  async function clearVisibleNotification() {
    if (Platform.OS === "web") return;
    const id = Array.isArray(params.notificationId) ? params.notificationId[0] : params.notificationId;
    if (id) await Notifications.dismissNotificationAsync(id).catch(() => undefined);
  }

  async function dismiss() {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await clearVisibleNotification();
    router.replace("/alarms" as never);
  }

  async function snooze() {
    void Haptics.selectionAsync();
    if (alarmId) {
      await scheduleAlarmSnooze({
        alarmId,
        label,
        snoozeMinutes,
        sound: true,
      }).catch(() => undefined);
    }
    await clearVisibleNotification();
    router.replace("/alarms" as never);
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safe}>
      <View style={styles.screen}>
        <View style={styles.top}>
          <Text style={styles.eyebrow}>KAMPUSONE ALARM</Text>
          <Text style={styles.clock}>{formatClock(Array.isArray(params.time) ? params.time[0] : params.time)}</Text>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.meta}>
            Ringing for up to 3 minutes · {Math.ceil(remaining / 60)} min left
          </Text>
        </View>

        <View style={styles.visualWrap}>
          <Animated.View
            style={[
              styles.pulse,
              {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.04] }),
                transform: [{
                  scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.24] }),
                }],
              },
            ]}
          />
          <View style={styles.alarmDisc}>
            <Ionicons name="alarm-outline" size={58} color="#FFFFFF" />
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Snooze for ${snoozeMinutes} minutes`}
            onPress={() => void snooze()}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          >
            <Ionicons name="time-outline" size={20} color={theme.deepBrand} />
            <Text style={styles.secondaryText}>Snooze {snoozeMinutes} min</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss alarm"
            onPress={() => void dismiss()}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Ionicons name="checkmark" size={22} color="#FFFFFF" />
            <Text style={styles.primaryText}>Dismiss</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.canvas },
  screen: { flex: 1, width: "100%", maxWidth: 540, alignSelf: "center", paddingHorizontal: 24, paddingVertical: 20, justifyContent: "space-between" },
  top: { alignItems: "center", paddingTop: 28 },
  eyebrow: { color: theme.deepBrand, fontFamily: theme.font.bold, fontSize: 11, letterSpacing: 1.2 },
  clock: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 54, letterSpacing: -1.8, marginTop: 18 },
  label: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 20, textAlign: "center", marginTop: 10 },
  meta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, textAlign: "center", marginTop: 7 },
  visualWrap: { alignItems: "center", justifyContent: "center", minHeight: 230 },
  pulse: { position: "absolute", width: 190, height: 190, borderRadius: 95, backgroundColor: theme.brand },
  alarmDisc: { width: 124, height: 124, borderRadius: 62, backgroundColor: theme.deepBrand, alignItems: "center", justifyContent: "center", ...theme.floatingShadow },
  actions: { gap: 12, paddingBottom: 10 },
  secondary: { minHeight: 58, borderRadius: 18, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surfaceRaised, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  secondaryText: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 15 },
  primary: { minHeight: 62, borderRadius: 19, backgroundColor: theme.deepBrand, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 16 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
