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
function normalizeCapabilities(value: unknown): Capabilities {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const profiles = Array.isArray(raw.profiles)
    ? raw.profiles.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        if (typeof item.id !== "string" || !["VENDOR","TUTOR","RIDER"].includes(String(item.agent_type))) return [];
        return [{
          id: item.id,
          agent_type: item.agent_type as "VENDOR"|"TUTOR"|"RIDER",
          display_name: typeof item.display_name === "string" ? item.display_name : "Workspace",
        }];
      })
    : [];
  const communities = Array.isArray(raw.communities)
    ? raw.communities.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        if (typeof item.id !== "string") return [];
        return [{ id: item.id, name: typeof item.name === "string" ? item.name : "Community" }];
      })
    : [];
  return { profiles, communities };
}
export function useCapabilities() {
  const [ready,setReady] = useState(false);
  const [error,setError] = useState("");
  const [data, setData] = useState<Capabilities>({
    profiles: [],
    communities: [],
  });
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void api<Capabilities>("/v1/account/capabilities")
        .then((r) => {
          if (active) {setData(normalizeCapabilities(r));setReady(true);setError("");}
        })
        .catch((caught:unknown) => {
          if (active) {setReady(true);setError(caught instanceof Error ? caught.message : "Your workspaces could not load.");}
        });
      return () => {
        active = false;
      };
    }, []),
  );
  return {...data,ready,error};
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
