import { useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import { ToolPage, ToolButton } from "@/src/components/toolkit";
import { EmptyResult } from "@/src/components/product-ui";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
type Guide = {
  id: string;
  title: string;
  body: string;
  source_url: string | null;
};
export default function Guidelines() {
  const { theme } = useAppearance();
  const toast = useToast();
  const [items, setItems] = useState<Guide[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void api<{ guidelines: Guide[] }>("/v1/account/guidelines")
      .then((r) => {
        setItems(r.guidelines);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, [toast]);
  return (
    <ToolPage title="Campus guidelines">
      {ready && !items.length ? (
        <EmptyResult title="No guidelines yet" />
      ) : null}
      {items.map((g) => (
        <View key={g.id} style={{ marginBottom: 24 }}>
          <Text
            style={{
              color: theme.text,
              fontSize: 20,
              fontFamily: theme.font.display,
              marginBottom: 12,
            }}
          >
            {g.title}
          </Text>
          <Text
            style={{
              color: theme.textMuted,
              lineHeight: 23,
              fontFamily: theme.font.body,
            }}
          >
            {g.body}
          </Text>
          {g.source_url && /^https:\/\//.test(g.source_url) ? (
            <ToolButton
              secondary
              label="View source"
              onPress={() => void Linking.openURL(g.source_url!)}
            />
          ) : null}
        </View>
      ))}
    </ToolPage>
  );
}
