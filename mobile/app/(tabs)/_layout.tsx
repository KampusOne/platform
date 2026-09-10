import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";

import { theme } from "@/src/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

function TabIcon({ name, color }: { name: IconName; color: ColorValue }) {
  return <Ionicons name={name} size={21} color={color} />;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.brand,
        tabBarInactiveTintColor: "#82756D",
        tabBarLabelStyle: {
          fontFamily: "Manrope-SemiBold",
          fontSize: 10,
          marginTop: 1,
        },
        tabBarStyle: {
          backgroundColor: "#FFFDFC",
          borderTopColor: "#E7DDD5",
          height: 72,
          paddingBottom: 11,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Today",
          tabBarIcon: ({ color }) => <TabIcon name="sunny-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: "Feed",
          tabBarIcon: ({ color }) => <TabIcon name="newspaper-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="campus"
        options={{
          title: "Campus",
          tabBarIcon: ({ color }) => <TabIcon name="map-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="tutorials"
        options={{
          title: "Tutorials",
          tabBarIcon: ({ color }) => <TabIcon name="school-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="store"
        options={{
          title: "Store",
          tabBarIcon: ({ color }) => <TabIcon name="bag-handle-outline" color={color} />,
        }}
      />
    </Tabs>
  );
}
