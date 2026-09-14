import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { View } from "react-native";
import { ToolRow } from "./toolkit";
import { api } from "@/src/lib/api";
export type Capabilities = {
  profiles: {
    id: string;
    agent_type: "VENDOR" | "TUTOR" | "RIDER";
    display_name: string;
  }[];
  communities: { id: string; name: string }[];
};
export function useCapabilities() {
  const [data, setData] = useState<Capabilities>({
    profiles: [],
    communities: [],
  });
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void api<Capabilities>("/v1/account/capabilities")
        .then((r) => {
          if (active) setData(r);
        })
        .catch(() => {
          if (active) setData({ profiles: [], communities: [] });
        });
      return () => {
        active = false;
      };
    }, []),
  );
  return data;
}
export function AgentShortcuts() {
  const data = useCapabilities();
  if (!data.profiles.length && !data.communities.length) return null;
  return (
    <View style={{ marginVertical: 16 }}>
      {data.profiles.map((p) => (
        <ToolRow
          key={p.id}
          title={
            p.agent_type === "VENDOR"
              ? "Seller dashboard"
              : p.agent_type === "TUTOR"
                ? "Tutor dashboard"
                : "Rider dashboard"
          }
          icon={
            p.agent_type === "VENDOR"
              ? "storefront-outline"
              : p.agent_type === "TUTOR"
                ? "school-outline"
                : "bicycle-outline"
          }
          onPress={() =>
            router.push({ pathname: "/agent", params: { role: p.agent_type } })
          }
        />
      ))}
      {data.communities.length ? (
        <ToolRow
          title="Course rep dashboard"
          icon="people-outline"
          onPress={() => router.push("/communities")}
        />
      ) : null}
    </View>
  );
}
