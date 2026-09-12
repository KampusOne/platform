import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Redirect, Tabs } from "expo-router";
import { type ComponentProps, useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/auth-context";
import { useReducedMotionPreference } from "@/src/components/visual-system";
import { theme } from "@/src/theme";

type IconName = keyof typeof Ionicons.glyphMap;
type TabBarRenderer = NonNullable<ComponentProps<typeof Tabs>["tabBar"]>;
type KampusTabBarProps = Parameters<TabBarRenderer>[0];

const primaryItems = [
  { name: "index", label: "Home", icon: "home-outline" as IconName, activeIcon: "home" as IconName },
  { name: "feed", label: "Feed", icon: "newspaper-outline" as IconName, activeIcon: "newspaper" as IconName },
  { name: "explore", label: "Explore", icon: "compass-outline" as IconName, activeIcon: "compass" as IconName },
  { name: "map", label: "Map", icon: "map-outline" as IconName, activeIcon: "map" as IconName },
  { name: "profile", label: "Profile", icon: "person-outline" as IconName, activeIcon: "person" as IconName },
] as const;

const activeParent: Record<string, (typeof primaryItems)[number]["name"]> = {
  campus: "map",
  gpa: "explore",
  purchases: "profile",
  store: "explore",
  timetable: "explore",
  tutorials: "explore",
};

function NavItem({ activeIcon, focused, icon, label, onLongPress, onPress }: {
  activeIcon: IconName;
  focused: boolean;
  icon: IconName;
  label: string;
  onLongPress: () => void;
  onPress: () => void;
}) {
  const focus = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const reducedMotion = useReducedMotionPreference();

  useEffect(() => {
    if (reducedMotion) {
      focus.setValue(focused ? 1 : 0);
      return;
    }
    Animated.timing(focus, {
      duration: theme.motion.standard,
      easing: Easing.out(Easing.cubic),
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
    }).start();
  }, [focus, focused, reducedMotion]);

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      onLongPress={onLongPress}
      onPress={onPress}
      style={styles.navItem}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.navPill,
          {
            opacity: focus,
            transform: [{ scale: focus.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
          },
        ]}
      />
      <Animated.View
        style={{
          transform: [
            { translateY: focus.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) },
            { scale: focus.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) },
          ],
        }}
      >
        <Ionicons color={focused ? theme.deepBrand : theme.textMuted} name={focused ? activeIcon : icon} size={22} />
      </Animated.View>
      <Text style={[styles.navLabel, focused && styles.navLabelFocused]}>{label}</Text>
    </Pressable>
  );
}

function KampusTabBar({ state, navigation }: KampusTabBarProps) {
  const insets = useSafeAreaInsets();
  const routeName = state.routes[state.index]?.name ?? "index";
  const activeName = activeParent[routeName] ?? routeName;

  return (
    <View pointerEvents="box-none" style={[styles.navPosition, { bottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.glassDock}>
        <BlurView
          experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : "none"}
          intensity={30}
          style={StyleSheet.absoluteFill}
          tint="light"
        />
        <View pointerEvents="none" style={styles.dockTint} />
        <View pointerEvents="none" style={styles.dockHighlight} />
        {primaryItems.map((item) => {
          const route = state.routes.find((candidate) => candidate.name === item.name);
          const focused = activeName === item.name;
          return (
            <NavItem
              activeIcon={item.activeIcon}
              focused={focused}
              icon={item.icon}
              key={item.name}
              label={item.label}
              onLongPress={() => {
                if (route) navigation.emit({ type: "tabLongPress", target: route.key });
              }}
              onPress={() => {
                if (!route) return;
                void Haptics.selectionAsync();
                const event = navigation.emit({ canPreventDefault: true, target: route.key, type: "tabPress" });
                if (routeName !== route.name && !event.defaultPrevented) navigation.navigate(route.name);
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

export default function TabLayout() {
  const { state, profile, profileState } = useAuth();
  const reducedMotion = useReducedMotionPreference();
  if (state === "loading" || (state === "authenticated" && profileState === "loading")) {
    return <View style={styles.loading}><ActivityIndicator color={theme.brand} size="large" /></View>;
  }
  if (state === "anonymous") return <Redirect href="/(auth)/welcome" />;
  if (state === "authenticated" && profileState === "error") return <Redirect href="/" />;
  if (state === "authenticated" && profileState === "ready" && !profile?.onboarding_completed_at) return <Redirect href="/(auth)/onboarding" />;

  return (
    <Tabs
      backBehavior="history"
      tabBar={(props) => <KampusTabBar {...props} />}
      screenOptions={{
        animation: reducedMotion ? "none" : "fade",
        headerShown: false,
        sceneStyle: { backgroundColor: theme.canvas },
        tabBarHideOnKeyboard: true,
        transitionSpec: { animation: "timing", config: { duration: reducedMotion ? 0 : 180 } },
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="feed" />
      <Tabs.Screen name="explore" />
      <Tabs.Screen name="map" />
      <Tabs.Screen name="profile" />
      <Tabs.Screen name="campus" options={{ href: null }} />
      <Tabs.Screen name="tutorials" options={{ href: null }} />
      <Tabs.Screen name="store" options={{ href: null }} />
      <Tabs.Screen name="timetable" options={{ href: null }} />
      <Tabs.Screen name="gpa" options={{ href: null }} />
      <Tabs.Screen name="purchases" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: "center", backgroundColor: theme.canvas, flex: 1, justifyContent: "center" },
  navPosition: { alignSelf: "center", left: 14, maxWidth: 520, position: "absolute", right: 14 },
  glassDock: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.72)",
    borderColor: "rgba(255,255,255,0.94)",
    borderRadius: 28,
    borderWidth: 1,
    flexDirection: "row",
    height: 72,
    overflow: "hidden",
    paddingHorizontal: 5,
    ...theme.floatingShadow,
  },
  dockTint: { backgroundColor: "rgba(251,247,242,0.42)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  dockHighlight: { backgroundColor: "rgba(255,255,255,0.92)", height: 1, left: 18, position: "absolute", right: 18, top: 1 },
  navItem: { alignItems: "center", flex: 1, height: 62, justifyContent: "center", minWidth: 54, position: "relative" },
  navPill: { backgroundColor: "rgba(233,177,142,0.27)", borderRadius: 21, height: 54, position: "absolute", top: 4, width: 62 },
  navLabel: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 10.5, lineHeight: 14, marginTop: 3 },
  navLabelFocused: { color: theme.deepBrand, fontFamily: theme.font.semibold },
});
