import {GuidelineArticle} from "@/src/components/guideline-article";
import { useCallback, useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import { router } from "expo-router";
import { ToolPage, ToolButton } from "@/src/components/toolkit";
import { EmptyResult } from "@/src/components/product-ui";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { useAuth } from "@/src/auth/auth-context";
import { api } from "@/src/lib/api";
type Guide = {
  id: string;
  title: string;
  body: string;
  source_url: string | null;
  published_at?: string | null;
  source_filename?: string | null;
  source_page?: string | number | null;
  issuing_institution?: string | null;
  document_date?: string | null;
  session_label?: string | null;
  programme_name?: string | null;
  version?: string | number | null;
  scope?: string | null;
  effective_from?: string | null;
};
export default function Guidelines() {
  const { theme } = useAppearance();
  const { profile } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<Guide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api<{ guidelines: Guide[] }>(
        "/v1/account/guidelines",
      );
      setItems(Array.isArray(response.guidelines) ? response.guidelines : []);
    } catch {
      setError("Campus guidelines could not load right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <ToolPage title="Campus guidelines">
      <Text
        style={{
          color: theme.textMuted,
          fontFamily: theme.font.medium,
          marginBottom: 18,
        }}
      >
        {profile?.university_name || "Your institution"}
      </Text>
      {loading ? (
        <ScreenSkeleton variant="learning" compact />
      ) : error ? (
        <View>
          <Text
            accessibilityRole="alert"
            style={{
              color: theme.text,
              fontFamily: theme.font.display,
              fontSize: 20,
              marginBottom: 8,
            }}
          >
            Couldn’t load campus guidelines
          </Text>
          <Text
            style={{
              color: theme.textMuted,
              fontFamily: theme.font.body,
              lineHeight: 22,
              marginBottom: 14,
            }}
          >
            {error}
          </Text>
          <ToolButton secondary label="Try again" onPress={() => void load()} />
        </View>
      ) : !items.length ? (
        <>
          <EmptyResult title="No published guidelines yet" />
          <Text
            style={{
              color: theme.textMuted,
              fontFamily: theme.font.body,
              lineHeight: 22,
            }}
          >
            Your university's reviewed rules will appear here. Check your
            school's official handbook while these are being prepared.
          </Text>
          <ToolButton
            secondary
            label="Request a guideline or report missing information"
            onPress={() =>
              router.push({
                pathname: "/support",
                params: { category: "CONTENT" },
              })
            }
          />
        </>
      ) : (
        items.map((g) => (
          <View
            key={g.id}
            style={{
              marginBottom: 28,
              paddingBottom: 20,
              borderBottomWidth: 1,
              borderColor: theme.border,
            }}
          >
            <Text
              style={{
                color: theme.text,
                fontSize: 21,
                fontFamily: theme.font.display,
                marginBottom: 12,
              }}
            >
              {g.title}
            </Text>
            {g.scope ? (
              <Text
                style={{
                  color: theme.brand,
                  fontFamily: theme.font.medium,
                  marginBottom: 8,
                }}
              >
                {g.scope}
              </Text>
            ) : null}
            <GuidelineArticle body={g.body}/>
            {g.source_filename ? (
              <Text
                style={{
                  color: theme.textMuted,
                  fontFamily: theme.font.body,
                  marginTop: 12,
                  fontSize: 12,
                }}
              >
                Source: {g.source_filename}
                {g.source_page ? ` · page ${g.source_page}` : ""}
              </Text>
            ) : null}
            {g.issuing_institution || g.document_date || g.source_page ? (
              <Text
                style={{
                  color: theme.textMuted,
                  fontFamily: theme.font.body,
                  fontSize: 12,
                  lineHeight: 20,
                  marginTop: 12,
                }}
              >
                {[
                  g.issuing_institution,
                  g.document_date ? `Source date: ${g.document_date}` : null,
                  g.source_page ? `Page ${g.source_page}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            ) : null}
            {g.session_label ||
            g.programme_name ||
            g.effective_from ||
            g.version ? (
              <Text
                style={{
                  color: theme.textMuted,
                  fontFamily: theme.font.body,
                  fontSize: 12,
                  lineHeight: 20,
                  marginTop: 8,
                }}
              >
                {[
                  g.programme_name,
                  g.session_label,
                  g.effective_from
                    ? `Effective from ${g.effective_from}`
                    : null,
                  g.version ? `Version ${g.version}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            ) : null}
            {g.published_at ? (
              <Text
                style={{
                  color: theme.textMuted,
                  fontFamily: theme.font.body,
                  fontSize: 12,
                  marginTop: 12,
                }}
              >
                Published {new Date(g.published_at).toLocaleDateString()}
              </Text>
            ) : null}
            {g.source_url && /^https:\/\//.test(g.source_url) ? (
              <ToolButton
                secondary
                label="View source"
                onPress={() =>
                  void Linking.openURL(g.source_url!).catch(() =>
                    toast("The source could not open. Try again.", "error"),
                  )
                }
              />
            ) : null}
          </View>
        ))
      )}
    </ToolPage>
  );
}
