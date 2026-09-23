import { MediaImage } from "./media-image";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { memo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import type { FeedPostData } from "@/src/lib/feed-posts";
import { safeCount, type SocialFeedPost } from "@/src/lib/feed-social";
import { feedTime, compactCount } from "@/src/lib/feed-time";
import { getFeedPostText } from "@/src/lib/feed-post-text";
import { PostMenu } from "./post-menu";
import { QuotedPostPreview } from "./quoted-post";
import { RepostAction } from "./repost-action";
import { PostLikeButton } from "./post-like-button";
import { ProfileAvatar } from "./profile-avatar";
import { VerifiedBadge } from "./verified-badge";
import { RelativeTime } from "./relative-time";
import { ReplyComposer } from "./reply-composer";
import { PostMetrics } from "./post-metrics";

const structuredCategories = new Set(["EVENT", "OPPORTUNITY"]);
export const FeedPost = memo(function FeedPost({ post, onBookmark, onShare, onDeleted, onFeedback, onChanged, onComment, detail = false }: {
  post: SocialFeedPost;
  onBookmark(post: FeedPostData): void;
  onShare(post: FeedPostData): void;
  onDeleted(id: string): void;
  onFeedback(message: string): void;
  onChanged?(post: SocialFeedPost): void;
  onComment?(): void;
  detail?: boolean;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  const { width } = useWindowDimensions();
  const [replyOpen, setReplyOpen] = useState(false);
  const category = post.category.toUpperCase();
  const text = getFeedPostText(post);
  const structured = structuredCategories.has(category);
  const openPost = () => { if (!detail) router.push({ pathname: "/post", params: { id: post.id } }); };
  const openReply = () => { if (onComment) onComment(); else setReplyOpen(true); };
  const copy = text.title || text.paragraphs.length ? <View style={styles.postCopy}>
    {text.title ? <Text style={[styles.postTitle, detail && styles.detailText]}>{text.title}</Text> : null}
    {text.paragraphs.map((paragraph, index) => <Text key={index} style={[styles.postText, detail && styles.detailText]}>{paragraph}</Text>)}
  </View> : null;
  return <View style={styles.post}>
    {post.repost_by ? <View style={styles.repostedBy}><Ionicons name="repeat-outline" size={13} color={theme.textMuted} /><Text numberOfLines={1} style={styles.repostedText}>{post.repost_by.name || "A KampusOne user"} reposted</Text></View> : null}
    {/* Content and action buttons are separate hit regions. Empty avatar-gutter space opens the post too. */}
    <View style={styles.contentRegion}>
      <Pressable accessibilityRole={detail ? undefined : "button"} accessibilityLabel={detail ? undefined : `Open conversation by ${post.source_name}`} disabled={detail} onPress={openPost} style={styles.postContent}>
        <View style={styles.postHeader}>
          <ProfileAvatar name={post.source_name} imageUrl={post.source_image_url} size={38} />
          <View style={styles.sourceCopy}>
            <View style={styles.sourceNameRow}>
              <Text accessibilityLabel={`${post.source_name}${post.source_verified ? ", verified" : ""}`} numberOfLines={1} style={styles.sourceName}>{post.source_name}</Text>
              {post.source_verified ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><VerifiedBadge size={13} /></View> : null}
              {!detail ? <><Text style={styles.postTime}>·</Text><RelativeTime value={post.published_at} style={styles.postTime} /></> : null}
            </View>
            {detail ? <RelativeTime value={post.published_at} style={styles.postTime} /> : null}
          </View>
        </View>
        <View style={[styles.postBody, detail && styles.detailBody]}>
          {structured ? <View style={styles.structuredPanel}><Text style={styles.structuredEyebrow}>{category === "EVENT" ? "CAMPUS EVENT" : "CAMPUS OPPORTUNITY"}</Text>{copy}</View> : copy}
          {post.urgent ? <Text style={styles.urgent}>Urgent campus update</Text> : null}
          {post.image_url ? <MediaImage accessible accessibilityIgnoresInvertColors accessibilityLabel="Post attachment" resizeMode="cover" uri={post.image_url} style={styles.postImage} /> : null}
          {post.quoted_post_id ? <QuotedPostPreview post={post.quoted_post ?? null} /> : null}
          {post.correction_note ? <View accessibilityRole="alert" style={styles.correction}><Ionicons color={theme.statusAttention} name="information-circle-outline" size={17} /><Text style={styles.correctionText}>Correction: {post.correction_note}</Text></View> : null}
        </View>
      </Pressable>
      <View style={styles.menu}><PostMenu post={post} onBookmark={onBookmark} onShare={onShare} onDeleted={onDeleted} onFeedback={onFeedback} /></View>
    </View>
    {detail ? <View style={styles.detailMeta}><Text style={styles.exactTime}>{feedTime(post.published_at).exact}</Text><PostMetrics post={post} detail /></View> : null}
    <View style={[styles.actions, (detail || width < 390) && styles.fullActions]}>
      <PostLikeButton initialLiked={post.liked} initialCount={post.like_count} postId={post.id} title={post.title} onFeedback={onFeedback} />
      {post.social_enabled ? <>
        <Pressable accessibilityLabel={`${safeCount(post.comment_count)} replies. Write a reply`} accessibilityRole="button" onPress={openReply} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Ionicons color={theme.textMuted} name="chatbubble-outline" size={18} /><Text style={styles.actionText}>{compactCount(post.comment_count)}</Text></Pressable>
        <RepostAction post={post} onFeedback={onFeedback} onChanged={onChanged} />
      </> : null}
      {!detail ? <PostMetrics post={post} /> : null}
      <Pressable accessibilityLabel={post.bookmarked ? "Remove from saved posts" : "Save post"} accessibilityRole="button" accessibilityState={{ selected: post.bookmarked }} onPress={() => onBookmark(post)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Ionicons color={post.bookmarked ? theme.brandPressed : theme.textMuted} name={post.bookmarked ? "bookmark" : "bookmark-outline"} size={18} /></Pressable>
      <Pressable accessibilityLabel="Share post link" accessibilityRole="button" onPress={() => onShare(post)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Ionicons color={theme.textMuted} name="share-social-outline" size={18} /></Pressable>
    </View>
    {post.sponsored ? <Text style={styles.sponsored}>SPONSORED</Text> : null}
    {replyOpen ? <ReplyComposer post={post} onClose={() => setReplyOpen(false)} onSent={() => { onChanged?.({ ...post, comment_count: safeCount(post.comment_count) + 1 }); onFeedback("Reply posted."); }} /> : null}
  </View>;
});
const createStyles = (theme: Theme) => StyleSheet.create({
  post: { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth, paddingTop: 10, paddingBottom: 3 }, contentRegion: { position: "relative" }, postContent: { width: "100%" },
  postHeader: { flexDirection: "row", alignItems: "flex-start", gap: 9, paddingRight: 36 }, sourceCopy: { flex: 1, minWidth: 0, paddingTop: 1 }, sourceNameRow: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 22 }, sourceName: { flexShrink: 1, color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 }, postTime: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, flexShrink: 0 }, menu: { position: "absolute", top: -5, right: -5 },
  postBody: { paddingLeft: 47, marginTop: -14, minHeight: 18 }, detailBody: { paddingLeft: 0, marginTop: 12 }, postCopy: { gap: 4 }, postTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14, lineHeight: 20 }, postText: { color: theme.text, fontFamily: theme.font.body, fontSize: 14, lineHeight: 20 }, detailText: { fontSize: 16, lineHeight: 23 },
  structuredPanel: { backgroundColor: theme.surfaceMuted, borderColor: theme.border, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginTop: 3, padding: 10 }, structuredEyebrow: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 9, letterSpacing: 0.7, marginBottom: 4 }, urgent: { color: theme.statusAttention, fontFamily: theme.font.semibold, fontSize: 11, marginTop: 7 },
  postImage: { width: "100%", aspectRatio: 1.5, borderRadius: 12, marginTop: 8 }, correction: { flexDirection: "row", alignItems: "flex-start", gap: 7, backgroundColor: theme.surfaceMuted, borderRadius: 10, marginTop: 8, padding: 9 }, correctionText: { color: theme.statusAttention, flex: 1, fontFamily: theme.font.medium, fontSize: 11, lineHeight: 16 },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginLeft: 47, minHeight: 44, flexWrap: "wrap" }, fullActions: { marginLeft: 0 }, action: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 44, minWidth: 44 }, actionText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11 }, pressed: { opacity: 0.7 },
  detailMeta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border, paddingVertical: 3, marginTop: 10 }, exactTime: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11 }, sponsored: { color: theme.textSubtle, fontFamily: theme.font.bold, fontSize: 8, letterSpacing: 0.8, marginLeft: 47 }, repostedBy: { flexDirection: "row", gap: 5, marginLeft: 47, marginBottom: 7, alignItems: "center" }, repostedText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11, flex: 1 },
});
