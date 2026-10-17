import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { isPlayDistribution } from "@/src/lib/digital-billing-policy";
import { shareItem } from "@/src/lib/share-content";
import { MediaImage } from "./media-image";
import { ProfileAvatar } from "./profile-avatar";
import { VerifiedBadge } from "./verified-badge";
import { ToolButton, ToolPage } from "./toolkit";
import { useToast } from "./toast";

export type LearningResource = {
  id: string;
  title: string;
  description: string;
  publisher_name: string;
  tutor_profile_id?: string | null;
  tutor_name?: string | null;
  tutor_image_url?: string | null;
  tutor_verified?: boolean;
  is_saved?: boolean;
  cover_url?: string | null;
  parts?: { title: string; mediaId: string }[];
  subject?: string | null;
  course_code: string;
  resource_type: string;
  page_count?: number | null;
  duration_seconds?: number | null;
  preview_text: string | null;
  access_model: string;
  can_access: boolean;
  pricing_ready?: boolean;
  price_kobo: number;
  listing_id: string | null;
};

const playBuild = isPlayDistribution(Platform.OS, process.env.EXPO_PUBLIC_ANDROID_DISTRIBUTION);
const formatPrice = (kobo: number) => new Intl.NumberFormat("en-NG", {
  style: "currency", currency: "NGN", maximumFractionDigits: kobo % 100 ? 2 : 0,
}).format(kobo / 100);
const resourceLabels: Record<string, string> = { PDF: "PDF", NOTE: "Notes", PAST_QUESTION: "Past questions", VIDEO: "Video", AUDIOBOOK: "Audio" };

export function LearningResourceDetails({ resource }: { resource: LearningResource }) {
  const { theme, styles } = useThemeStyles(createStyles);
  const toast = useToast();
  const [saved, setSaved] = useState(resource.is_saved === true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"overview" | "contents">("overview");
  const [expanded, setExpanded] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const saveRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { saveRequest.current?.abort(); }, []);

  const tutorName = resource.tutor_name?.trim() || resource.publisher_name;
  const parts = resource.parts ?? [];
  const kind = resourceLabels[resource.resource_type] ?? "Resource";
  const icon = resource.resource_type === "VIDEO" ? "play-circle-outline" : resource.resource_type === "AUDIOBOOK" ? "headset-outline" : "document-text-outline";
  const metadata = [kind, parts.length > 1 ? `${parts.length} parts` : null,
    resource.page_count ? `${resource.page_count} ${resource.page_count === 1 ? "page" : "pages"}` : null,
    resource.duration_seconds ? `${Math.ceil(resource.duration_seconds / 60)} min` : null].filter(Boolean).join(" · ");
  const paid = resource.access_model === "PAID";
  const purchaseBlocked = paid && !resource.can_access && (playBuild || resource.pricing_ready === false);
  const actionLabel = resource.can_access ? "Open resource" : paid ? (resource.pricing_ready === false ? "Available soon" : "Buy resource") : "View tutorial";

  async function toggleSaved() {
    if (saveRequest.current) return;
    const controller = new AbortController();
    saveRequest.current = controller;
    setSaving(true);
    try {
      const result = await api<{ saved: boolean }>(`/v1/student/tutorial-resources/${resource.id}/save`, {
        method: "PUT", body: JSON.stringify({ saved: !saved }), signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setSaved(result.saved);
        toast(result.saved ? "Saved to your learning library" : "Removed from your learning library", "success");
      }
    } catch (error) {
      if (!controller.signal.aborted) toast(error instanceof Error ? error.message : "Could not update your saved resources.", "error");
    } finally {
      if (!controller.signal.aborted) setSaving(false);
      if (saveRequest.current === controller) saveRequest.current = null;
    }
  }

  function open() {
    if (purchaseBlocked) return;
    if (resource.can_access) router.push({ pathname: "/learning-viewer", params: { id: resource.id } });
    else if (paid) router.push({ pathname: "/learning-checkout", params: { resourceId: resource.id, priceKobo: String(resource.price_kobo) } });
    else if (resource.listing_id) router.push({ pathname: "/(tabs)/tutorials", params: { listing: resource.listing_id } });
  }

  function study(summary = false) {
    router.push({ pathname: "/ai", params: {
      mode: summary ? "summary" : "explanation",
      question: summary
        ? `Summarise this preview of ${resource.title}. This is an extract, not the full document:\n\n${resource.preview_text}`
        : `Teach me ${resource.title} at my study level. ${resource.preview_text ? "This preview is supporting context, not the complete source:\n\n" + resource.preview_text : resource.description}`,
    } });
  }

  return <ToolPage title="Resource"
    action={<View style={styles.headerActions}>
      <Pressable accessibilityRole="button" accessibilityLabel={saved ? "Remove from saved resources" : "Save resource"}
        accessibilityState={{ selected: saved, disabled: saving, busy: saving }} disabled={saving} onPress={() => void toggleSaved()}
        style={({ pressed }) => [styles.iconButton, (pressed || saving) && styles.pressed]}>
        <Ionicons name={saved ? "bookmark" : "bookmark-outline"} size={22} color={theme.accentText} />
      </Pressable>
      {resource.resource_type !== "VIDEO" ? <Pressable accessibilityRole="button" accessibilityLabel="Share learning resource"
        onPress={() => void shareItem("material", resource.id, resource.title).catch(() => toast("Sharing could not open.", "error"))}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <Ionicons name="share-outline" size={22} color={theme.text} />
      </Pressable> : null}
    </View>}
    footer={<View style={styles.footer}>
      <View style={styles.priceCopy}>
        <Text style={styles.priceLabel}>{paid ? resource.can_access ? "Purchased" : "Price" : resource.access_model === "FREE" ? "Free to learn" : "Access"}</Text>
        <Text style={styles.price}>{paid ? formatPrice(resource.price_kobo) : resource.access_model === "FREE" ? "Free" : "With tutorial"}</Text>
      </View>
      <View style={styles.primaryAction}>
        {paid && !resource.can_access && playBuild ? <Text style={styles.muted}>Purchases are unavailable in this version.</Text>
          : resource.can_access || paid || resource.listing_id ? <ToolButton label={actionLabel} disabled={purchaseBlocked} onPress={open} />
          : <Text style={styles.muted}>This file is not available yet.</Text>}
      </View>
    </View>}>
    <View style={styles.content}>
      <View style={styles.cover}>
        {resource.cover_url ? <MediaImage uri={resource.cover_url} accessibilityLabel={`${resource.title} cover`} style={StyleSheet.absoluteFill} />
          : <Ionicons name={icon} size={64} color={theme.accentText} />}
        <View style={styles.coverLabel}><Ionicons name={icon} size={15} color={theme.text} /><Text style={styles.coverLabelText}>{metadata}</Text></View>
      </View>
      <View style={styles.heading}>
        {[resource.course_code, resource.subject].filter(Boolean).length ? <Text style={styles.eyebrow}>{[resource.course_code, resource.subject].filter(Boolean).join(" · ")}</Text> : null}
        <Text accessibilityRole="header" style={styles.title}>{resource.title}</Text>
      </View>
      <Pressable accessibilityRole={resource.tutor_profile_id ? "button" : undefined}
        accessibilityLabel={resource.tutor_profile_id ? `View tutor ${tutorName}${resource.tutor_verified === true ? ", verified" : ""}` : undefined}
        disabled={!resource.tutor_profile_id} onPress={() => { if (resource.tutor_profile_id) router.push({ pathname: "/student-service", params: { id: resource.tutor_profile_id } }); }}
        style={({ pressed }) => [styles.tutor, pressed && styles.pressed]}>
        <ProfileAvatar name={tutorName} imageUrl={resource.tutor_image_url} size={42} />
        <View style={styles.tutorCopy}>
          <Text style={styles.tutorLabel}>{resource.tutor_profile_id ? "Your tutor" : "Published by"}</Text>
          <View style={styles.tutorNameRow}><Text numberOfLines={2} style={styles.tutorName}>{tutorName}</Text>
            {resource.tutor_verified === true ? <VerifiedBadge size={16} label="Verified tutor" /> : null}
          </View>
        </View>
        {resource.tutor_profile_id ? <Ionicons name="chevron-forward" size={18} color={theme.textMuted} /> : null}
      </Pressable>
      {parts.length > 1 ? <View accessibilityRole="tablist" style={styles.tabs}>
        {(["overview", "contents"] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }}
          onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.activeTab]}>
          <Text style={[styles.tabText, tab === value && styles.activeTabText]}>{value === "overview" ? "Overview" : `Contents (${parts.length})`}</Text>
        </Pressable>)}
      </View> : null}
      {tab === "overview" ? <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>About this resource</Text>
        <Text numberOfLines={expanded || resource.description.length <= 180 ? undefined : 4} style={styles.body}>{resource.description || "The tutor has not added a description yet."}</Text>
        {resource.description.length > 180 ? <Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={expanded ? "Show less description" : "Read full description"}
          onPress={() => setExpanded(v => !v)} style={styles.textButton}><Text style={styles.link}>{expanded ? "Show less" : "Read more"}</Text></Pressable> : null}
        {resource.preview_text ? <View style={styles.preview}>
          <View style={styles.sectionHeading}><Ionicons name="document-text-outline" size={18} color={theme.accentText} /><Text style={styles.sectionTitle}>Preview</Text></View>
          <Text numberOfLines={previewExpanded || resource.preview_text.length <= 220 ? undefined : 5} style={styles.body}>{resource.preview_text}</Text>
          {resource.preview_text.length > 220 ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: previewExpanded }}
            onPress={() => setPreviewExpanded(v => !v)} style={styles.textButton}><Text style={styles.link}>{previewExpanded ? "Show less preview" : "Read full preview"}</Text></Pressable> : null}
        </View> : null}
      </View> : <View style={styles.section}>
        <Text style={styles.muted}>{resource.can_access ? "Open the resource to start learning." : "Included in this resource. Open it after you have access."}</Text>
        {parts.map((part, index) => <View key={`${part.mediaId}:${index}`} style={styles.part}>
          <View style={styles.partIcon}><Ionicons name={resource.can_access ? icon : "lock-closed-outline"} size={20} color={theme.accentText} /></View>
          <View style={styles.partCopy}><Text style={styles.partNumber}>Part {index + 1}</Text><Text style={styles.partTitle}>{part.title || `Part ${index + 1}`}</Text></View>
        </View>)}
      </View>}
      <View style={styles.kira}>
        <View style={styles.kiraHeading}>
          <View style={styles.kiraIcon}><Ionicons name="sparkles-outline" size={22} color={theme.accentText} /></View>
          <View style={styles.tutorCopy}><Text style={styles.sectionTitle}>Study with Kira</Text><Text style={styles.kiraHint}>Make this topic easier to understand.</Text></View>
        </View>
        <View style={styles.kiraActions}>
          <Pressable accessibilityRole="button" onPress={() => study()} style={({ pressed }) => [styles.kiraAction, pressed && styles.pressed]}>
            <Text style={styles.link}>Explain this topic</Text><Ionicons name="arrow-forward" size={17} color={theme.accentText} />
          </Pressable>
          {resource.preview_text ? <Pressable accessibilityRole="button" onPress={() => study(true)} style={({ pressed }) => [styles.kiraAction, pressed && styles.pressed]}><Text style={styles.link}>Summarise preview</Text></Pressable> : null}
        </View>
        <Text style={styles.kiraHint}>Attach the full file in Kira to study the whole resource.</Text>
      </View>
    </View>
  </ToolPage>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  headerActions: { flexDirection: "row", flexShrink: 0 },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.55 },
  content: { gap: 22 },
  cover: { width: "100%", aspectRatio: 1.6, borderRadius: 20, overflow: "hidden", backgroundColor: theme.surfaceMuted, alignItems: "center", justifyContent: "center" },
  coverLabel: { position: "absolute", bottom: 12, left: 12, maxWidth: "90%", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.surface },
  coverLabelText: { flexShrink: 1, fontFamily: theme.font.medium, fontSize: 12, color: theme.text },
  heading: { gap: 8 },
  eyebrow: { fontFamily: theme.font.medium, fontSize: 12, lineHeight: 18, color: theme.accentText },
  title: { fontFamily: theme.font.displayStrong, fontSize: 28, lineHeight: 34, color: theme.text },
  tutor: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: theme.border },
  tutorCopy: { flex: 1, minWidth: 0, gap: 5 },
  tutorLabel: { fontFamily: theme.font.body, fontSize: 11, color: theme.textMuted },
  tutorNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  tutorName: { flexShrink: 1, fontFamily: theme.font.semibold, fontSize: 14, lineHeight: 20, color: theme.text },
  tabs: { flexDirection: "row", gap: 24, borderBottomWidth: 1, borderBottomColor: theme.border },
  tab: { minHeight: 44, justifyContent: "center", paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  activeTab: { borderBottomColor: theme.accentText },
  tabText: { fontFamily: theme.font.medium, fontSize: 14, color: theme.textMuted },
  activeTabText: { color: theme.accentText },
  section: { gap: 12 },
  sectionTitle: { fontFamily: theme.font.semibold, fontSize: 15, lineHeight: 22, color: theme.text },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  body: { fontFamily: theme.font.body, fontSize: 14, lineHeight: 23, color: theme.textMuted },
  muted: { fontFamily: theme.font.body, fontSize: 12, lineHeight: 18, color: theme.textMuted },
  textButton: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  link: { fontFamily: theme.font.semibold, fontSize: 13, lineHeight: 20, color: theme.accentText },
  preview: { marginTop: 8, padding: 16, gap: 12, borderRadius: 16, backgroundColor: theme.surfaceMuted },
  part: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.border },
  partIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceMuted },
  partCopy: { flex: 1, gap: 4 },
  partNumber: { fontFamily: theme.font.body, fontSize: 11, color: theme.textMuted },
  partTitle: { fontFamily: theme.font.medium, fontSize: 14, lineHeight: 21, color: theme.text },
  kira: { gap: 8, padding: 16, borderWidth: 1, borderColor: theme.border, borderRadius: 18, backgroundColor: theme.surface },
  kiraHeading: { flexDirection: "row", alignItems: "center", gap: 12 },
  kiraIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: theme.surfaceTint, alignItems: "center", justifyContent: "center" },
  kiraHint: { fontFamily: theme.font.body, fontSize: 11, lineHeight: 17, color: theme.textMuted },
  kiraActions: { flexDirection: "row", flexWrap: "wrap", columnGap: 18 },
  kiraAction: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  footer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 16 },
  priceCopy: { gap: 4, flexShrink: 1 },
  priceLabel: { fontFamily: theme.font.body, fontSize: 11, color: theme.textMuted },
  price: { fontFamily: theme.font.bold, fontSize: 20, color: theme.accentText },
  primaryAction: { flex: 1, minWidth: 150 },
});
