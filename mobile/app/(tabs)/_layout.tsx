import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import type { ColorValue } from "react-native";

import { theme } from "@/src/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

function TabIcon({ name, color, focused }: { name: IconName; color: ColorValue; focused: boolean }) {
  return (
    <View style={[styles.iconShell, focused && styles.iconShellActive]}>
      <Ionicons name={focused ? name.replace("-outline", "") as IconName : name} size={20} color={color} />
    </View>
  );
}

export default function TabLayout() {
  const { width } = useWindowDimensions();
  const dockWidth = Math.min(Math.max(width - 24, 280), 520);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.brand,
        tabBarInactiveTintColor: theme.textSubtle,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: {
          fontFamily: theme.font.medium,
          fontSize: 11,
          marginTop: -1,
        },
        tabBarStyle: {
          backgroundColor: "rgba(255,253,252,0.97)",
          borderColor: "rgba(255,255,255,0.92)",
          borderRadius: 28,
          borderTopWidth: 1,
          bottom: 12,
          height: 72,
          left: (width - dockWidth) / 2,
          paddingBottom: 7,
          paddingTop: 5,
          position: "absolute",
          width: dockWidth,
          ...theme.floatingShadow,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => <TabIcon name="home-outline" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: "Feed",
          tabBarIcon: ({ color, focused }) => <TabIcon name="newspaper-outline" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="campus"
        options={{
          title: "Campus",
          tabBarIcon: ({ color, focused }) => <TabIcon name="map-outline" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="tutorials"
        options={{
          title: "Tutorials",
          tabBarIcon: ({ color, focused }) => <TabIcon name="school-outline" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="store"
        options={{
          title: "Store",
          tabBarIcon: ({ color, focused }) => <TabIcon name="bag-handle-outline" color={color} focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconShell: {
    alignItems: "center",
    borderRadius: 12,
    height: 29,
    justifyContent: "center",
    width: 44,
  },
  iconShellActive: {
    backgroundColor: "rgba(233,177,142,0.34)",
  },
});
