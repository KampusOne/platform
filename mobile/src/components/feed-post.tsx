import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import type { FeedPostData } from "@/src/lib/feed-posts";
import { safeCount, type SocialFeedPost } from "@/src/lib/feed-social";
import { getFeedPostText } from "@/src/lib/feed-post-text";
import { PostMenu } from "@/src/components/post-menu";
import { QuotedPostPreview } from "@/src/components/quoted-post";
import { RepostAction } from "@/src/components/repost-action";
import { PostLikeButton } from "@/src/components/post-like-button";

const structuredCategories = new Set(["EVENT", "OPPORTUNITY"]);
function publishedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recently" : new Intl.DateTimeFormat("en-NG", { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" }).format(date);
}

export function FeedPost({ post, onBookmark, onShare, onDeleted, onFeedback, onChanged, onComment }: {
  post: SocialFeedPost;
  onBookmark(post: FeedPostData): void;
  onShare(post: FeedPostData): void;
  onDeleted(id: string): void;
  onFeedback(message: string): void;
  onChanged?(post: SocialFeedPost): void;
  onComment?(): void;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  const category = post.category.toUpperCase();
  const text = getFeedPostText(post);
  const copy = text.title || text.paragraphs.length ? (
    <View style={styles.postCopy}>
      {text.title ? <Text style={styles.postTitle}>{text.title}</Text> : null}
      {text.paragraphs.map((paragraph, index) => <Text key={index} style={styles.postText}>{paragraph}</Text>)}
    </View>
  ) : null;
  const openComments = onComment ?? (() => router.push({ pathname: "/post", params: { id: post.id, comments: "1" } }));
  return (
    <View style={styles.post}>
      {post.repost_by ? <View style={styles.repostedBy}><Ionicons name="repeat-outline" size={13} color={theme.textMuted} /><Text numberOfLines={1} style={styles.repostedText}>{post.repost_by.name || "A KampusOne user"} reposted</Text></View> : null}
      <View style={styles.postHeader}>
        <View accessibilityElementsHidden style={styles.sourceAvatar}><Text style={styles.sourceAvatarText}>{post.source_name.slice(0, 2).toUpperCase()}</Text></View>
        <View style={styles.sourceCopy}>
          <View style={styles.sourceNameRow}>
            <Text accessibilityLabel={`${post.source_name}${post.source_verified ? ", verified" : ""}`} numberOfLines={1} style={styles.sourceName}>{post.source_name}</Text>
            {post.source_verified ? <View accessibilityElementsHidden style={styles.verifiedBadge}><Ionicons color={theme.verificationMark} name="checkmark" size={10} /></View> : null}
          </View>
          <Text style={styles.postTime}>{publishedAt(post.published_at)}</Text>
        </View>
        <View style={[styles.category, post.urgent && styles.urgentCategory]}><Text style={styles.categoryText}>{post.urgent ? "Urgent" : post.category.toLowerCase()}</Text></View>
        <PostMenu post={post} onBookmark={onBookmark} onShare={onShare} onDeleted={onDeleted} onFeedback={onFeedback} />
      </View>
      {structuredCategories.has(category) ? <View style={styles.structuredPanel}><Text style={styles.structuredEyebrow}>{category === "EVENT" ? "CAMPUS EVENT" : "CAMPUS OPPORTUNITY"}</Text>{copy}</View> : copy ? <View style={styles.postBody}>{copy}</View> : null}
      {post.image_url ? <Image accessible accessibilityIgnoresInvertColors accessibilityLabel="Post attachment" resizeMode="cover" source={{ uri: post.image_url }} style={styles.postImage} /> : null}
      {post.quoted_post_id ? <View style={styles.quote}><QuotedPostPreview post={post.quoted_post ?? null} /></View> : null}
      {post.correction_note ? <View accessibilityRole="alert" style={styles.correction}><Ionicons color={theme.statusAttention} name="information-circle-outline" size={17} /><Text style={styles.correctionText}>Correction: {post.correction_note}</Text></View> : null}
      <View style={styles.actions}>
        <PostLikeButton postId={post.id} title={post.title} onFeedback={onFeedback} />
        {post.social_enabled ? <>
          <Pressable accessibilityLabel={`${safeCount(post.comment_count)} comments. Add a comment`} accessibilityRole="button" onPress={openComments} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Ionicons color={theme.textMuted} name="chatbubble-outline" size={18} /><Text style={styles.actionText}>{safeCount(post.comment_count)}</Text></Pressable>
          <RepostAction post={post} onFeedback={onFeedback} onChanged={onChanged} />
        </> : null}
        <Pressable accessibilityLabel={post.bookmarked ? "Remove from saved posts" : "Save post"} accessibilityRole="button" accessibilityState={{ selected: post.bookmarked }} onPress={() => onBookmark(post)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Ionicons color={post.bookmarked ? theme.brandPressed : theme.textMuted} name={post.bookmarked ? "bookmark" : "bookmark-outline"} size={18} />
          {!post.social_enabled ? <Text style={styles.actionText}>{post.bookmarked ? "Saved" : "Save"}</Text> : null}
        </Pressable>
        <Pressable accessibilityLabel="Share post link" accessibilityRole="button" onPress={() => onShare(post)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Ionicons color={theme.textMuted} name="share-social-outline" size={18} />{!post.social_enabled ? <Text style={styles.actionText}>Share</Text> : null}</Pressable>
      </View>
      {post.sponsored ? <Text style={styles.sponsored}>SPONSORED</Text> : null}
    </View>
  );
}

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
  postBody: { paddingLeft: 44, paddingTop: 6 }, postCopy: { gap: 4 },
  postTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 15, lineHeight: 20 },
  postText: { color: theme.text, fontFamily: theme.font.body, fontSize: 13.5, lineHeight: 19 },
  structuredPanel: { backgroundColor: "rgba(241,223,200,.42)", borderColor: "rgba(168,70,46,.13)", borderRadius: 14, borderWidth: 1, marginLeft: 44, marginTop: 8, padding: 10 },
  structuredEyebrow: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 8.5, letterSpacing: 0.8, marginBottom: 4 },
  postImage: { alignSelf: "stretch", aspectRatio: 1.7, borderRadius: 14, marginLeft: 44, marginTop: 8 }, quote: { marginLeft: 44, marginTop: 8 },
  correction: { alignItems: "flex-start", backgroundColor: "#FFF7E9", borderRadius: 10, flexDirection: "row", gap: 7, marginLeft: 44, marginTop: 8, padding: 9 },
  correctionText: { color: theme.statusAttention, flex: 1, fontFamily: theme.font.medium, fontSize: 10.5, lineHeight: 15 },
  actions: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", gap: 4, marginLeft: 44, minHeight: 44, paddingTop: 2, flexWrap: "wrap" },
  action: { alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5, minHeight: 44, minWidth: 44 },
  actionText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11 },
  sponsored: { color: theme.textSubtle, fontFamily: theme.font.bold, fontSize: 8, letterSpacing: 0.8, marginLeft: 44 },
  repostedBy: { flexDirection: "row", gap: 5, marginLeft: 44, marginBottom: 7, alignItems: "center" },
  repostedText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11, flex: 1 }, pressed: { opacity: 0.72 },
});
