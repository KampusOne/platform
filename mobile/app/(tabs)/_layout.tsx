import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Tabs } from "expo-router";
import { type ComponentProps, useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReducedMotionPreference } from "@/src/components/visual-system";
import { theme } from "@/src/theme";

type IconName = keyof typeof Ionicons.glyphMap;
type TabBarRenderer = NonNullable<ComponentProps<typeof Tabs>["tabBar"]>;
type KampusTabBarProps = Parameters<TabBarRenderer>[0];

const primaryItems = [
  { name: "today", label: "Home", icon: "home-outline" as IconName },
  { name: "feed", label: "Feed", icon: "newspaper-outline" as IconName },
  { name: "campus", label: "Campus", icon: "map-outline" as IconName },
  { name: "tutorials", label: "Tutorials", icon: "school-outline" as IconName },
  { name: "store", label: "Store", icon: "bag-handle-outline" as IconName },
];

function NavItem({
  focused,
  icon,
  label,
  onLongPress,
  onPress,
}: {
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
      duration: 200,
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
        style={[
          styles.navPill,
          {
            opacity: focus.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
            transform: [{ scale: focus.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
          },
        ]}
      />
      <Animated.View
        style={{
          transform: [
            { translateY: focus.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) },
            { scale: focus.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) },
          ],
        }}
      >
        <Ionicons name={focused ? (icon.replace("-outline", "") as IconName) : icon} size={22} color={focused ? theme.brandPressed : "#6F6A66"} />
      </Animated.View>
      <Text style={[styles.navLabel, focused && styles.navLabelFocused]}>{label}</Text>
    </Pressable>
  );
}

function KampusTabBar({ state, navigation }: KampusTabBarProps) {
  const insets = useSafeAreaInsets();
  const activeName = state.routes[state.index]?.name ?? "today";
  const profileOpen = activeName === "profile";
  const displayItems = profileOpen
    ? [...primaryItems.slice(0, 4), { name: "profile", label: "Profile", icon: "person-outline" as IconName }]
    : primaryItems;
  const normalizedActive = activeName === "timetable" ? "today" : activeName;

  return (
    <View pointerEvents="box-none" style={[styles.navPosition, { bottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.glassDock}>
        <BlurView
          experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : "none"}
          intensity={48}
          style={StyleSheet.absoluteFill}
          tint="light"
        />
        <View pointerEvents="none" style={styles.dockTint} />
        <View pointerEvents="none" style={styles.dockGlowLeft} />
        <View pointerEvents="none" style={styles.dockGlowRight} />
        <View pointerEvents="none" style={styles.dockHighlight} />
        {displayItems.map((item) => {
          const route = state.routes.find((candidate) => candidate.name === item.name);
          const focused = normalizedActive === item.name;
          return (
            <NavItem
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
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <KampusTabBar {...props} />}
      screenOptions={{
        animation: "fade",
        headerShown: false,
        sceneStyle: { backgroundColor: theme.canvas },
        tabBarHideOnKeyboard: true,
        transitionSpec: { animation: "timing", config: { duration: 180 } },
      }}
    >
      <Tabs.Screen name="today" />
      <Tabs.Screen name="feed" />
      <Tabs.Screen name="campus" />
      <Tabs.Screen name="tutorials" />
      <Tabs.Screen name="store" />
      <Tabs.Screen name="timetable" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  navPosition: { left: 12, marginHorizontal: "auto", maxWidth: 520, position: "absolute", right: 12 },
  glassDock: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.56)",
    borderColor: "rgba(255,255,255,0.98)",
    borderRadius: 29,
    borderWidth: 1,
    flexDirection: "row",
    height: 78,
    overflow: "hidden",
    paddingHorizontal: 6,
    ...theme.glassShadow,
  },
  dockTint: { backgroundColor: "rgba(255,255,255,0.44)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  dockGlowLeft: { backgroundColor: "rgba(233,177,142,0.19)", borderRadius: 55, height: 90, left: -28, position: "absolute", top: -43, width: 132 },
  dockGlowRight: { backgroundColor: "rgba(241,223,200,0.25)", borderRadius: 48, bottom: -54, height: 90, position: "absolute", right: -12, width: 129 },
  dockHighlight: { backgroundColor: "rgba(255,255,255,0.92)", height: 1, left: 20, position: "absolute", right: 20, top: 1 },
  navItem: { alignItems: "center", flex: 1, height: 64, justifyContent: "center", position: "relative" },
  navPill: { backgroundColor: "rgba(233,177,142,0.31)", borderColor: "rgba(255,255,255,0.76)", borderRadius: 15, borderWidth: 1, height: 38, position: "absolute", top: 4, width: 52 },
  navLabel: { color: "#726D69", fontFamily: theme.font.medium, fontSize: 10.5, marginTop: 4 },
  navLabelFocused: { color: theme.brandPressed, fontFamily: theme.font.semibold },
});
