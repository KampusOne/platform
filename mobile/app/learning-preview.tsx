import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { ToolButton, ToolPage } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";
import { validSharedId } from "@/src/lib/shared-links";
import { shareItem } from "@/src/lib/share-content";
type Resource = {
  id: string;
  title: string;
  description: string;
  publisher_name: string;
  course_code: string;
  resource_type: string;
  preview_text: string | null;
  access_model: string;
  can_access: boolean;
  pricing_ready?: boolean;
  price_kobo: number;
  file_url: string | null;
  media_object_id: string | null;
  listing_id: string | null;
};
export default function LearningPreview() {
  const { id } = useLocalSearchParams<{ id?: string }>(),
    { user } = useAuth(),
    { theme } = useAppearance(),
    toast = useToast();
  const [resource, setResource] = useState<Resource | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setLoading(true);
    setResource(null);
    setError("");
    if (!validSharedId(id)) {
      setError("This resource link is not valid.");
      setLoading(false);
      return;
    }
    void api<{ resource: Resource }>(`/v1/student/tutorial-resources/${id}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((r) => {
        if (live) setResource(r.resource);
      })
      .catch((e) => {
        if (live)
          setError(
            e instanceof Error ? e.message : "This resource could not load.",
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [id, user?.id, retry]);
  async function open() {
    if (!resource || busy) return;
    setBusy(true);
    try {
      if (resource.access_model === "PAID") {
        router.push("/learning-library");
        return;
      }
      let url = resource.file_url;
      if (resource.media_object_id) {
        const r = await api<{ url: string }>(
          `/v1/media/${resource.media_object_id}/access`,
          { method: "POST" },
        );
        url = r.url;
      }
      if (!url) throw new Error("This file is not available yet.");
      await Linking.openURL(url);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Could not open this resource.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage
      title="Learning resource"
      action={
        resource ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share learning resource"
            onPress={() =>
              void shareItem("material", resource.id, resource.title).catch(
                () => toast("Sharing could not open.", "error"),
              )
            }
            style={{
              minHeight: 44,
              minWidth: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="share-outline" size={22} color={theme.brand} />
          </Pressable>
        ) : undefined
      }
    >
      {loading ? (
        <ScreenSkeleton />
      ) : error ? (
        <>
          <Text accessibilityRole="alert" style={{ color: theme.text }}>
            {error}
          </Text>
          <ToolButton label="Retry" onPress={() => setRetry((n) => n + 1)} />
        </>
      ) : resource ? (
        <View style={{ gap: 18 }}>
          <Text
            style={{
              color: theme.brand,
              fontFamily: theme.font.semibold,
              fontSize: 12,
            }}
          >
            {resource.course_code} ·{" "}
            {resource.resource_type.replaceAll("_", " ")}
          </Text>
          <Text
            style={{
              color: theme.text,
              fontFamily: theme.font.display,
              fontSize: 27,
            }}
          >
            {resource.title}
          </Text>
          <Text style={{ color: theme.textMuted, fontFamily: theme.font.body }}>
            By {resource.publisher_name}
          </Text>
          <Text
            style={{
              color: theme.text,
              fontFamily: theme.font.body,
              fontSize: 14,
              lineHeight: 22,
            }}
          >
            {resource.description}
          </Text>
          {resource.preview_text ? (
            <View
              style={{
                backgroundColor: theme.surfaceMuted,
                padding: 18,
                borderRadius: 14,
              }}
            >
              <Text
                style={{
                  color: theme.text,
                  fontFamily: theme.font.body,
                  lineHeight: 23,
                }}
              >
                {resource.preview_text}
              </Text>
            </View>
          ) : null}
          <View style={{gap:8,borderTopWidth:1,borderTopColor:theme.border,paddingTop:16}}>
            <Text style={{color:theme.text,fontFamily:theme.font.semibold}}>Study with Kira</Text>
            <Text style={{color:theme.textMuted,fontFamily:theme.font.body,fontSize:12,lineHeight:18}}>Use the visible preview or explore this topic. Attach the full file in Kira for a complete document lesson.</Text>
            {resource.preview_text ? <ToolButton label="Summarise preview" onPress={()=>router.push({pathname:"/ai",params:{mode:"summary",question:`Summarise this preview of ${resource.title}. This is an extract, not the full document:\n\n${resource.preview_text}`}})}/> : null}
            <ToolButton label="Explain this topic" onPress={()=>router.push({pathname:"/ai",params:{mode:"explanation",question:`Teach me ${resource.title} at my study level. ${resource.preview_text ? "This preview is supporting context, not the complete source:\n\n"+resource.preview_text : resource.description}`}})}/>
          </View>
          {resource.can_access ? (
            <ToolButton
              label={busy ? "Opening…" : "Open my resource"}
              disabled={busy}
              onPress={() => void open()}
            />
          ) : resource.access_model === "PAID" ? (
            <>
              <Text
                style={{
                  color: theme.text,
                  fontFamily: theme.font.semibold,
                  fontSize: 22,
                }}
              >
                ₦{(resource.price_kobo / 100).toLocaleString("en-NG")}
              </Text>
              <ToolButton
                label={
                  resource.pricing_ready === false
                    ? "Access is being connected"
                    : "Buy resource"
                }
                disabled={resource.pricing_ready === false}
                onPress={() =>
                  router.push({
                    pathname: "/learning-checkout",
                    params: {
                      resourceId: resource.id,
                      priceKobo: String(resource.price_kobo),
                    },
                  })
                }
              />
            </>
          ) : resource.listing_id ? (
            <ToolButton
              label="View the tutorial"
              onPress={() =>
                router.push({
                  pathname: "/(tabs)/tutorials",
                  params: { listing: resource.listing_id! },
                })
              }
            />
          ) : (
            <Text style={{ color: theme.textMuted }}>
              The publisher has not made this file available.
            </Text>
          )}
        </View>
      ) : null}
    </ToolPage>
  );
}
