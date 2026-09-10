import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Linking, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, Vibration, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { InlineFeedback, ProductScreen } from "@/src/components/product-ui";
import { theme } from "@/src/theme";

type PermissionState = "granted" | "blocked" | "unknown";
const STORAGE_KEY = "kampusone:permission-state:v1";

export default function PermissionsScreen() {
  const [notificationState, setNotificationState] = useState<PermissionState>("unknown");
  const [locationState, setLocationState] = useState<PermissionState>("unknown");
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((value) => {
      if (!value) return;
      try {
        const stored = JSON.parse(value) as { notification?: PermissionState; location?: PermissionState };
        setNotificationState(stored.notification ?? "unknown");
        setLocationState(stored.location ?? "unknown");
      } catch {
        setMessage("Permission status could not be read on this device.");
      }
    });
  }, []);

  async function persist(notification: PermissionState, location: PermissionState) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ notification, location }));
  }

  async function requestNotifications() {
    let next: PermissionState = "unknown";
    if (Platform.OS === "android") {
      const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
      const result = await PermissionsAndroid.request(permission);
      next = result === PermissionsAndroid.RESULTS.GRANTED ? "granted" : "blocked";
    } else if (Platform.OS === "web" && "Notification" in globalThis) {
      const result = await globalThis.Notification.requestPermission();
      next = result === "granted" ? "granted" : "blocked";
    } else {
      await Linking.openSettings();
      setMessage("KampusOne opened system settings. Return here after allowing notifications.");
      return;
    }
    setNotificationState(next);
    await persist(next, locationState);
    setMessage(next === "granted" ? "Notifications are allowed on this device." : "Notifications remain off. You can enable them later in system settings.");
  }

  async function requestLocation() {
    if (Platform.OS === "android") {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      const next = result === PermissionsAndroid.RESULTS.GRANTED ? "granted" : "blocked";
      setLocationState(next);
      await persist(notificationState, next);
      setMessage(next === "granted" ? "Location while using KampusOne is allowed." : "Location remains off. Campus directions will still work without live positioning.");
      return;
    }
    if (Platform.OS === "web" && "geolocation" in globalThis.navigator) {
      globalThis.navigator.geolocation.getCurrentPosition(
        () => {
          setLocationState("granted");
          void persist(notificationState, "granted");
          setMessage("Location while using KampusOne is allowed.");
        },
        () => {
          setLocationState("blocked");
          void persist(notificationState, "blocked");
          setMessage("Location remains off. You can change it from your browser settings.");
        },
        { enableHighAccuracy: false, timeout: 8000 },
      );
      return;
    }
    await Linking.openSettings();
    setMessage("KampusOne opened system settings. Return here after allowing location access.");
  }

  function testAlarm() {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Vibration.vibrate([0, 220, 100, 220]);
    setMessage("Test alarm sent inside KampusOne. Background sound and push delivery unlock after the Expo project is connected.");
  }

  return (
    <ProductScreen>
      <AppHeader
        badge={{ icon: "shield-checkmark", text: "You stay in control" }}
        showBell={false}
        subtitle="Allow only what helps KampusOne keep your day on track."
        title="Permissions"
        unread={false}
      />

      <View style={styles.heroCard}>
        <View style={styles.heroArt}>
          <Ionicons name="notifications" size={37} color="#FFFFFF" />
          <View style={styles.heroPin}><Ionicons name="location" size={19} color={theme.deepBrand} /></View>
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.heroTitle}>Don&apos;t miss your next class.</Text>
          <Text style={styles.heroBody}>Notifications power class reminders, safety notices and delivery updates. Location is used while the app is open for campus directions and nearby delivery matching.</Text>
        </View>
      </View>

      {message ? <InlineFeedback message={message} tone={message.includes("allowed") ? "success" : "brand"} /> : null}

      <PermissionCard
        body="Class alarms, important campus notices, order updates and messages from trusted services."
        icon="notifications-outline"
        label="Notifications"
        onPress={() => void requestNotifications()}
        state={notificationState}
      />
      <PermissionCard
        body="Live campus directions and matching nearby riders while KampusOne is in use. Never background tracking by default."
        icon="location-outline"
        label="Location while using app"
        onPress={() => void requestLocation()}
        state={locationState}
      />

      <Pressable accessibilityRole="button" onPress={testAlarm} style={({ pressed }) => [styles.testButton, pressed && styles.pressed]}>
        <View style={styles.testIcon}><Ionicons name="alarm-outline" size={23} color={theme.brandPressed} /></View>
        <View style={styles.testCopy}><Text style={styles.testTitle}>Test app alarm</Text><Text style={styles.testBody}>Run the in-app vibration test on this device.</Text></View>
        <Ionicons name="play" size={18} color={theme.brandPressed} />
      </Pressable>

      <View style={styles.privacyNote}>
        <Ionicons name="lock-closed-outline" size={19} color={theme.statusPositive} />
        <Text style={styles.privacyText}>You can use the core app without live location. Permission changes are recorded only as operational status—KampusOne does not sell precise-location data.</Text>
      </View>
    </ProductScreen>
  );
}

function PermissionCard({ label, body, icon, state, onPress }: { label: string; body: string; icon: keyof typeof Ionicons.glyphMap; state: PermissionState; onPress: () => void }) {
  const granted = state === "granted";
  return (
    <View style={styles.permissionCard}>
      <View style={styles.permissionIcon}><Ionicons name={icon} size={23} color={theme.brandPressed} /></View>
      <View style={styles.permissionCopy}>
        <View style={styles.permissionHeading}><Text style={styles.permissionTitle}>{label}</Text><View style={[styles.state, granted && styles.stateGranted]}><Text style={[styles.stateText, granted && styles.stateTextGranted]}>{granted ? "Allowed" : state === "blocked" ? "Off" : "Review"}</Text></View></View>
        <Text style={styles.permissionBody}>{body}</Text>
        <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.allowButton, pressed && styles.pressed]}>
          <Text style={styles.allowText}>{granted ? "Review in settings" : "Allow permission"}</Text><Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroCard: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 24, flexDirection: "row", gap: 15, marginBottom: 14, padding: 18, ...theme.floatingShadow },
  heroArt: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.13)", borderRadius: 24, height: 78, justifyContent: "center", position: "relative", width: 78 },
  heroPin: { alignItems: "center", backgroundColor: theme.sand, borderRadius: 14, bottom: -5, height: 29, justifyContent: "center", position: "absolute", right: -5, width: 29 },
  heroCopy: { flex: 1 },
  heroTitle: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 19, lineHeight: 23 },
  heroBody: { color: "rgba(255,255,255,0.72)", fontFamily: theme.font.body, fontSize: 11, lineHeight: 16.5, marginTop: 5 },
  permissionCard: { alignItems: "flex-start", backgroundColor: "rgba(255,253,252,0.92)", borderColor: "rgba(255,255,255,0.98)", borderRadius: 20, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 10, padding: 15, ...theme.shadow },
  permissionIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.26)", borderRadius: 15, height: 48, justifyContent: "center", width: 48 },
  permissionCopy: { flex: 1 },
  permissionHeading: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  permissionTitle: { color: theme.text, flex: 1, fontFamily: theme.font.semibold, fontSize: 13.5 },
  permissionBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 5 },
  state: { backgroundColor: theme.surfaceMuted, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  stateGranted: { backgroundColor: "rgba(154,91,62,0.12)" },
  stateText: { color: theme.textSubtle, fontFamily: theme.font.bold, fontSize: 9.5 },
  stateTextGranted: { color: theme.statusPositive },
  allowButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: theme.brand, borderRadius: 11, flexDirection: "row", gap: 5, marginTop: 11, minHeight: 36, paddingHorizontal: 11 },
  allowText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 10.5 },
  testButton: { alignItems: "center", backgroundColor: "rgba(252,230,220,0.64)", borderColor: "rgba(195,93,56,0.12)", borderRadius: 18, borderWidth: 1, flexDirection: "row", marginTop: 6, padding: 13 },
  testIcon: { alignItems: "center", backgroundColor: theme.warmWhite, borderRadius: 14, height: 46, justifyContent: "center", width: 46 },
  testCopy: { flex: 1, marginLeft: 10 },
  testTitle: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 13 },
  testBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, marginTop: 3 },
  privacyNote: { alignItems: "flex-start", flexDirection: "row", gap: 9, marginTop: 18, paddingHorizontal: 4 },
  privacyText: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 11, lineHeight: 17 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
