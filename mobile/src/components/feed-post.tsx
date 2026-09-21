import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import type { FeedPostData } from "@/src/lib/feed-posts";
import { getFeedPostText } from "@/src/lib/feed-post-text";
import { PostMenu } from "@/src/components/post-menu";
import { PostLikeButton } from "@/src/components/post-like-button";

const structuredCategories = new Set(["EVENT", "OPPORTUNITY"]);
const categoryIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  EMERGENCY: "warning-outline", EVENT: "calendar-outline", OPPORTUNITY: "briefcase-outline", SPORTS: "football-outline", UPDATE: "newspaper-outline",
};

function formatPublishedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" }).format(date);
}

export function FeedPost({ post, onBookmark, onShare, onDeleted, onFeedback }: {
  post: FeedPostData;
  onBookmark(post: FeedPostData): void;
  onShare(post: FeedPostData): void;
  onDeleted(id: string): void;
  onFeedback(message: string): void;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  const category = post.category.toUpperCase();
  const structured = structuredCategories.has(category);
  const categoryLabel = post.urgent ? "Urgent" : post.category.toLowerCase();
  const text = getFeedPostText(post);
  const copy = text.title || text.paragraphs.length ? (
    <View style={styles.postCopy}>
      {text.title ? <Text style={styles.postTitle}>{text.title}</Text> : null}
      {text.paragraphs.map((paragraph, index) => <Text key={index} style={styles.postText}>{paragraph}</Text>)}
    </View>
  ) : null;

  return (
    <View style={styles.post}>
      <View style={styles.postHeader}>
        <View accessibilityElementsHidden style={styles.sourceAvatar}>
          <Text style={styles.sourceAvatarText}>{post.source_name.slice(0, 2).toUpperCase()}</Text>
        </View>
        <View style={styles.sourceCopy}>
          <View style={styles.sourceNameRow}>
            <Text accessibilityLabel={`${post.source_name}${post.source_verified ? ", verified campus source" : ""}`} numberOfLines={1} style={styles.sourceName}>{post.source_name}</Text>
            {post.source_verified ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.verifiedBadge}><Ionicons color={theme.verificationMark} name="checkmark" size={10} /></View> : null}
          </View>
          <Text style={styles.postTime}>{formatPublishedAt(post.published_at)}</Text>
        </View>
        <View style={[styles.category, post.urgent && styles.urgentCategory]}>
          <Text style={[styles.categoryText, post.urgent && styles.urgentCategoryText]}>{categoryLabel}</Text>
        </View>
        <PostMenu post={post} onBookmark={onBookmark} onShare={onShare} onDeleted={onDeleted} onFeedback={onFeedback} />
      </View>
      {structured ? (
        <View style={styles.structuredPanel}>
          <View style={styles.structuredIcon}><Ionicons color={theme.deepBrand} name={categoryIcons[category] ?? "newspaper-outline"} size={18} /></View>
          <View style={styles.structuredCopy}>
            <Text style={styles.structuredEyebrow}>{category === "EVENT" ? "CAMPUS EVENT" : "CAMPUS OPPORTUNITY"}</Text>
            {copy}
          </View>
        </View>
      ) : copy ? <View style={styles.postBody}>{copy}</View> : null}
      {post.image_url ? <Image accessible accessibilityIgnoresInvertColors accessibilityLabel={`Attached image for ${post.title}`} accessibilityRole="image" resizeMode="cover" source={{ uri: post.image_url }} style={styles.postImage} /> : null}
      {post.correction_note ? <View accessibilityRole="alert" style={styles.correction}><Ionicons color={theme.statusAttention} name="information-circle-outline" size={17} /><Text style={styles.correctionText}>Correction: {post.correction_note}</Text></View> : null}
      <View style={styles.actions}>
        <PostLikeButton postId={post.id} title={post.title} onFeedback={onFeedback} />
        <Pressable accessibilityLabel={post.bookmarked ? `Remove ${post.title} from saved posts` : `Save ${post.title}`} accessibilityRole="button" accessibilityState={{ selected: post.bookmarked }} hitSlop={4} onPress={() => onBookmark(post)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Ionicons color={post.bookmarked ? theme.brandPressed : theme.textMuted} name={post.bookmarked ? "bookmark" : "bookmark-outline"} size={18} />
          <Text style={[styles.actionText, post.bookmarked && styles.actionTextActive]}>{post.bookmarked ? "Saved" : "Save"}</Text>
        </Pressable>
        <Pressable accessibilityLabel={`Share ${post.title}`} accessibilityRole="button" hitSlop={4} onPress={() => onShare(post)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Ionicons color={theme.textMuted} name="share-social-outline" size={18} />
          <Text style={styles.actionText}>Share</Text>
        </Pressable>
        {post.sponsored ? <Text style={styles.sponsored}>SPONSORED</Text> : <View />}
      </View>
    </View>
  );
}

// Compact visual spacing; action touch targets remain at least 44 points tall.
const createStyles = (theme: Theme) => StyleSheet.create({
  post: { borderBottomColor: theme.border, borderBottomWidth: 1, paddingVertical: 12 },
  postHeader: { alignItems: "center", flexDirection: "row" },
  sourceAvatar: { alignItems: "center", backgroundColor: theme.sand, borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  sourceAvatarText: { color: theme.deepBrand, fontFamily: theme.font.bold, fontSize: 10.5 },
  sourceCopy: { flex: 1, marginLeft: 8, minWidth: 0 },
  sourceNameRow: { alignItems: "center", flexDirection: "row", gap: 5 },
  sourceName: { color: theme.text, flexShrink: 1, fontFamily: theme.font.semibold, fontSize: 13 },
  verifiedBadge: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 8, height: 16, justifyContent: "center", width: 16 },
  postTime: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 10.5, marginTop: 2 },
  category: { backgroundColor: theme.surfaceMuted, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  urgentCategory: { backgroundColor: "rgba(168,70,46,.12)" },
  categoryText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 10, textTransform: "capitalize" },
  urgentCategoryText: { color: theme.deepBrand },
  postBody: { paddingLeft: 44, paddingTop: 6 },
  postCopy: { gap: 4 },
  postTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 15, lineHeight: 20 },
  postText: { color: theme.text, fontFamily: theme.font.body, fontSize: 13.5, lineHeight: 19 },
  structuredPanel: { backgroundColor: "rgba(241,223,200,.42)", borderColor: "rgba(168,70,46,.13)", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 9, marginLeft: 44, marginTop: 8, padding: 10 },
  structuredIcon: { alignItems: "center", backgroundColor: "rgba(255,253,252,.82)", borderRadius: 11, height: 32, justifyContent: "center", width: 32 },
  structuredCopy: { flex: 1, minWidth: 0 },
  structuredEyebrow: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 8.5, letterSpacing: 0.8, marginBottom: 4 },
  postImage: { alignSelf: "stretch", aspectRatio: 1.7, borderRadius: 14, marginLeft: 44, marginTop: 8 },
  correction: { alignItems: "flex-start", backgroundColor: "#FFF7E9", borderRadius: 10, flexDirection: "row", gap: 7, marginLeft: 44, marginTop: 8, padding: 9 },
  correctionText: { color: theme.statusAttention, flex: 1, fontFamily: theme.font.medium, fontSize: 10.5, lineHeight: 15 },
  actions: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 0, marginLeft: 44, minHeight: 44, paddingTop: 2 },
  action: { alignItems: "center", flexDirection: "row", gap: 5, minHeight: 44, minWidth: 60 },
  actionText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11 },
  actionTextActive: { color: theme.brandPressed },
  sponsored: { color: theme.textSubtle, fontFamily: theme.font.bold, fontSize: 8, letterSpacing: 0.8, marginLeft: "auto" },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
});
