import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { ToolField, ToolPage, ToolRow } from "@/src/components/toolkit";
import { EmptyResult } from "@/src/components/product-ui";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/lib/api";
type Community = {
  id: string;
  name: string;
  level_code: string;
  members: number;
  joined_at: string | null;
  archived_at: string | null;
};
export default function Communities() {
  const [rows, setRows] = useState<Community[]>([]),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(true);
  const toast = useToast();
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void api<{ rows: Community[] }>("/v1/communities")
        .then((r) => {
          if (active) setRows(r.rows);
        })
        .catch((e) => toast(e.message))
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [toast]),
  );
  const filtered = rows.filter((r) =>
    r.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <ToolPage title="Class communities">
      <ToolField
        label="Find your class"
        placeholder="Department or set"
        value={query}
        onChangeText={setQuery}
      />
      {loading ? (
        <ScreenSkeleton />
      ) : filtered.length ? (
        filtered.map((c) => (
          <ToolRow
            key={c.id}
            title={c.name}
            detail={`${c.members} members · ${c.archived_at ? "Archived" : c.joined_at ? "Joined" : c.level_code + " level"}`}
            icon="people-outline"
            onPress={() =>
              router.push({ pathname: "/community", params: { id: c.id } })
            }
          />
        ))
      ) : (
        <EmptyResult title="No communities yet" />
      )}
    </ToolPage>
  );
}
