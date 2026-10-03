import { MediaPreview, type MediaPlaybackHandle } from "./media-preview";
import { PostImage } from "./post-image";
import { PostMediaSlider } from "./post-media-slider";
import { PostText } from "./post-text";
import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { memo, useCallback, useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import type { FeedPostData } from "@/src/lib/feed-posts";
import { safeCount, type FeedPublishing, type SocialFeedPost } from "@/src/lib/feed-social";
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
import { analyticsScreenName, trackContentAction } from "@/src/lib/analytics";
import { api } from "@/src/lib/api";
import { ActivityDetails } from "./activity-details";

const structuredCategories = new Set(["EVENT", "SPORTS", "OPPORTUNITY"]);

function InlinePoll({
  post,
  onChanged,
  onFeedback,
}: {
  post: SocialFeedPost;
  onChanged: ((post: SocialFeedPost) => void) | undefined;
  onFeedback(message: string): void;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  const [poll, setPoll] = useState(post.publishing ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPoll(post.publishing ?? null);
  }, [post.publishing]);

  if (!poll || poll.format !== "POLL") return null;
  const options = Array.isArray(poll.options)
    ? poll.options.filter(
        (option) =>
          Boolean(option) &&
          Number.isFinite(Number(option.id)) &&
          typeof option.label === "string",
      )
    : [];
  if (!options.length) return null;

  const totalVotes = options.reduce(
    (sum, option) => sum + safeCount(option.votes),
    0,
  );
  const closed = Boolean(
    poll.closesAt && Date.parse(poll.closesAt) <= Date.now(),
  );
  const locked = busy || closed || Boolean(poll.myVote);

  async function vote(optionId: number) {
    if (locked || !poll || poll.format !== "POLL") return;
    const before: FeedPublishing = poll;
    const next: FeedPublishing = {
      ...before,
      myVote: optionId,
      options: options.map((option) =>
        option.id === optionId
          ? { ...option, votes: safeCount(option.votes) + 1 }
          : option,
      ),
    };
    setPoll(next);
    onChanged?.({ ...post, publishing: next });
    setBusy(true);
    try {
      await api(`/v1/student/publishing/posts/${post.id}/vote`, {
        method: "POST",
        body: JSON.stringify({ optionId }),
      });
    } catch (caught) {
      setPoll(before);
      onChanged?.({ ...post, publishing: before });
      onFeedback(
        caught instanceof Error
          ? caught.message
          : "Your vote could not be saved. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.pollCard}>
      <View style={styles.pollTopline}>
        <View style={styles.pollBadge}>
          <Ionicons
            name={poll.anonymousPoll ? "eye-off-outline" : "stats-chart-outline"}
            size={14}
            color={theme.deepBrand}
          />
          <Text style={styles.pollBadgeText}>
            {poll.anonymousPoll ? "Anonymous poll" : "Campus poll"}
          </Text>
        </View>
        {closed ? <Text style={styles.pollClosed}>Closed</Text> : null}
      </View>

      <View style={styles.pollOptions}>
        {options.map((option) => {
          const selected = poll.myVote === option.id;
          const votes = safeCount(option.votes);
          const denominator = Math.max(
            1,
            poll.myVote ? totalVotes : totalVotes,
          );
          const percent = totalVotes
            ? Math.round((votes / denominator) * 100)
            : 0;
          const showResults = Boolean(poll.myVote) || closed;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: locked }}
              disabled={locked}
              onPress={() => void vote(option.id)}
              style={({ pressed }) => [
                styles.pollOption,
                selected && styles.pollOptionSelected,
                pressed && styles.pressed,
              ]}
            >
              {showResults ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.pollOptionFill,
                    { width: `${percent}%` as `${number}%` },
                  ]}
                />
              ) : null}
              <View style={styles.pollOptionContent}>
                <View
                  style={[
                    styles.pollRadio,
                    selected && styles.pollRadioSelected,
                  ]}
                >
                  {selected ? (
                    <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                  ) : null}
                </View>
                <Text numberOfLines={3} style={styles.pollOptionLabel}>
                  {option.label}
                </Text>
                {showResults ? (
                  <Text style={styles.pollPercent}>{percent}%</Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.pollFooter}>
        <Text style={styles.pollMeta}>
          {totalVotes.toLocaleString()} {totalVotes === 1 ? "vote" : "votes"}
          {poll.closesAt && !closed
            ? ` · closes ${new Date(poll.closesAt).toLocaleDateString("en-NG", {
                day: "numeric",
                month: "short",
              })}`
            : ""}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: "/publishing-post",
              params: { id: post.id },
            })
          }
          style={styles.pollDetails}
        >
          <Text style={styles.pollDetailsText}>Details</Text>
          <Ionicons name="chevron-forward" size={14} color={theme.deepBrand} />
        </Pressable>
      </View>
    </View>
  );
}
export const FeedPost = memo(function FeedPost({ post: unsafePost, onBookmark, onShare, onDeleted, onFeedback, onChanged, onComment, onVideoHandle, videoAutoPlay = false, detail = false }: {
  post: SocialFeedPost;
  onBookmark(post: FeedPostData): void;
  onShare(post: FeedPostData): void;
  onDeleted(id: string): void;
  onFeedback(message: string): void;
  onChanged?(post: SocialFeedPost): void;
  onComment?(): void;
  onVideoHandle?(postId: string, handle: MediaPlaybackHandle | null): void;
  videoAutoPlay?: boolean;
  detail?: boolean;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  const pathname = usePathname();
  const screen = analyticsScreenName(pathname);
  const { width } = useWindowDimensions();
  const [replyOpen, setReplyOpen] = useState(false);
  const media = Array.isArray(unsafePost.media)
    ? unsafePost.media.filter(
        (item) =>
          Boolean(item) &&
          typeof item.url === "string" &&
          typeof item.type === "string",
      )
    : [];
  const post: SocialFeedPost = { ...unsafePost, media };
  const category = typeof post.category === "string" ? post.category.toUpperCase() : "UPDATE";
  const text = getFeedPostText(post);
  const structured = structuredCategories.has(category);
  const videoUrl =
    post.media?.length === 1 && post.media[0]?.type?.startsWith("video/")
      ? post.media[0].url
      : post.image_url &&
          (post.media_type === "video" || post.media_type?.startsWith("video/"))
        ? post.image_url
        : "";
  const setVideoHandle = useCallback((handle: MediaPlaybackHandle | null) => {
    onVideoHandle?.(post.id, handle);
  }, [onVideoHandle, post.id]);
  const openVideo = useCallback((state: { position: number; muted: boolean }) => {
    trackContentAction("open_post_video", {
      screen,
      component: "post_media",
    });
    router.push({
      pathname: "/video",
      params: {
        id: post.id,
        position: String(state.position),
        muted: state.muted ? "1" : "0",
        url: videoUrl,
      },
    });
  }, [post.id, videoUrl, screen]);
  const openPost = () => {
    if (!detail) {
      trackContentAction("open_post", { screen, component: "post_body" });
      router.push({ pathname: "/post", params: { id: post.id } });
    }
  };
  const openReply = () => {
    trackContentAction("open_reply_composer", {
      screen,
      component: "post_action",
    });
    if (onComment) onComment();
    else setReplyOpen(true);
  };
  const openAuthor = () => {
    if (post.source_user_id) {
      trackContentAction("open_author_profile", {
        screen,
        component: "post_header",
      });
      router.push({ pathname: "/student-profile", params: { id: post.source_user_id } });
    } else {
      openPost();
    }
  };
  const bookmarkPost = (target: FeedPostData) => {
    trackContentAction(post.bookmarked ? "unsave_post" : "save_post", {
      screen,
      component: "post_action",
    });
    onBookmark(target);
  };
  const sharePost = (target: FeedPostData) => {
    trackContentAction("share_post", { screen, component: "post_action" });
    onShare(target);
  };
  const copy = text.title || text.paragraphs.length ? <PostText key={post.id} {...text} detail={detail} style={[styles.postText, detail && styles.detailText]} titleStyle={[styles.postTitle, detail && styles.detailText]} onError={onFeedback} /> : null;
  return <View style={styles.post}>
    {post.repost_by ? <View style={styles.repostedBy}><Ionicons name="repeat-outline" size={13} color={theme.textMuted} /><Text numberOfLines={1} style={styles.repostedText}>{post.repost_by.name || "A KampusOne user"} reposted</Text></View> : null}
    {/* Content and action buttons are separate hit regions. Empty avatar-gutter space opens the post too. */}
    <View style={styles.contentRegion}>
      <View style={styles.postContent}>
        <Pressable accessibilityRole="button" accessibilityLabel={post.source_user_id ? `View ${post.source_name}'s profile` : `Open conversation by ${post.source_name}`} onPress={openAuthor} style={styles.postHeader}>
          <ProfileAvatar name={post.source_name} imageUrl={post.source_image_url} size={38} />
          <View style={styles.sourceCopy}>
            <View style={styles.sourceNameRow}>
              <Text accessibilityLabel={`${post.source_name}${post.source_verified ? ", verified" : ""}`} numberOfLines={1} style={styles.sourceName}>{post.source_name}</Text>
              {post.source_verified ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><VerifiedBadge size={13} /></View> : null}
              {!detail ? <><Text style={styles.postTime}>·</Text><RelativeTime value={post.published_at} style={styles.postTime} /></> : null}
            </View>
            {detail ? <RelativeTime value={post.published_at} style={styles.postTime} /> : null}
          </View>
        </Pressable>
        <Pressable accessibilityRole={detail ? undefined : "button"} accessibilityLabel={`Open conversation by ${post.source_name}`} onPress={openPost} style={[styles.postBody, detail && styles.detailBody]}>
          {structured ? <View style={styles.structuredPanel}><Text style={styles.structuredEyebrow}>{category === "EVENT" ? "CAMPUS EVENT" : category === "SPORTS" ? "CAMPUS SPORTS" : "CAMPUS OPPORTUNITY"}</Text>{copy}</View> : copy}
          {post.urgent ? <Text style={styles.urgent}>Urgent campus update</Text> : null}
          {post.media && post.media.length > 1 ? <PostMediaSlider items={post.media} /> : post.media?.length === 1 ? (post.media[0]!.type?.startsWith("video/") ? <MediaPreview url={post.media[0]!.url} video label="Post video" initialAspect={post.media[0]!.width&&post.media[0]!.height?post.media[0]!.width!/post.media[0]!.height!:undefined} playbackMode={videoAutoPlay ? "feed-autoplay" : onVideoHandle ? "manual-managed" : "unmanaged"} onPlaybackHandle={onVideoHandle ? setVideoHandle : undefined} suspended={replyOpen} playbackKey={post.id} onOpen={openVideo} {...(post.source_username ? { watermark: post.source_username } : {})} /> : <PostImage initialAspect={post.media[0]!.width&&post.media[0]!.height?post.media[0]!.width!/post.media[0]!.height!:undefined} uri={post.media[0]!.url} />) : post.image_url ? (post.media_type === "video" || post.media_type?.startsWith("video/")) ? <MediaPreview url={post.image_url} video label="Post video" initialAspect={post.media_width&&post.media_height?post.media_width/post.media_height:undefined} playbackMode={videoAutoPlay ? "feed-autoplay" : onVideoHandle ? "manual-managed" : "unmanaged"} onPlaybackHandle={onVideoHandle ? setVideoHandle : undefined} suspended={replyOpen} playbackKey={post.id} onOpen={openVideo} {...(post.source_username ? { watermark: post.source_username } : {})} /> : <PostImage initialAspect={post.media_width&&post.media_height?post.media_width/post.media_height:undefined} uri={post.image_url} /> : null}
          {post.publishing?.format === "POLL" ? <InlinePoll post={post} onChanged={onChanged} onFeedback={onFeedback} /> : null}
          {post.quoted_post_id ? <QuotedPostPreview post={post.quoted_post ?? null} /> : null}
          {post.correction_note ? <View accessibilityRole="alert" style={styles.correction}><Ionicons color={theme.statusAttention} name="information-circle-outline" size={17} /><Text style={styles.correctionText}>Correction: {post.correction_note}</Text></View> : null}
        </Pressable>
      </View>
      <View style={styles.menu}><PostMenu post={post} onBookmark={bookmarkPost} onShare={sharePost} onDeleted={onDeleted} onFeedback={onFeedback} /></View>
    </View>
    <ActivityDetails post={post} onError={onFeedback} />
    {detail ? <View style={styles.detailMeta}><Text style={styles.exactTime}>{feedTime(post.published_at).exact}</Text><PostMetrics post={post} detail /></View> : null}
    <View style={[styles.actions, (detail || width < 390) && styles.fullActions]}>
      <PostLikeButton initialLiked={post.liked} initialCount={post.like_count} postId={post.id} title={post.title} onFeedback={onFeedback} />
      {post.social_enabled ? <>
        <Pressable accessibilityLabel={`${safeCount(post.comment_count)} replies. Write a reply`} accessibilityRole="button" onPress={openReply} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Ionicons color={theme.textMuted} name="chatbubble-outline" size={18} /><Text style={styles.actionText}>{compactCount(post.comment_count)}</Text></Pressable>
        <RepostAction post={post} onFeedback={onFeedback} onChanged={onChanged} />
      </> : null}
      {!detail ? <PostMetrics post={post} /> : null}
      <Pressable accessibilityLabel={post.bookmarked ? "Remove from saved posts" : "Save post"} accessibilityRole="button" accessibilityState={{ selected: post.bookmarked }} onPress={() => bookmarkPost(post)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Ionicons color={post.bookmarked ? theme.brandPressed : theme.textMuted} name={post.bookmarked ? "bookmark" : "bookmark-outline"} size={18} /></Pressable>
      <Pressable accessibilityLabel="Share post link" accessibilityRole="button" onPress={() => sharePost(post)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Ionicons color={theme.textMuted} name="share-social-outline" size={18} /></Pressable>
    </View>
    {post.sponsored ? <Text style={styles.sponsored}>SPONSORED</Text> : null}
    {replyOpen ? <ReplyComposer post={post} onClose={() => setReplyOpen(false)} onSent={() => {
      trackContentAction("reply_posted", { screen, component: "reply_composer" });
      onChanged?.({ ...post, comment_count: safeCount(post.comment_count) + 1 });
      onFeedback("Reply posted.");
    }} /> : null}
  </View>;
});
const createStyles = (theme: Theme) => StyleSheet.create({
  post: { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth, paddingTop: 10, paddingBottom: 3 }, contentRegion: { position: "relative" }, postContent: { width: "100%" },
  postHeader: { flexDirection: "row", alignItems: "flex-start", gap: 9, paddingRight: 36 }, sourceCopy: { flex: 1, minWidth: 0, paddingTop: 1 }, sourceNameRow: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 22 }, sourceName: { flexShrink: 1, color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 }, postTime: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, flexShrink: 0 }, menu: { position: "absolute", top: -5, right: -5 },
  postBody: { paddingLeft: 47, marginTop: 0, minHeight: 26 }, detailBody: { paddingLeft: 0, marginTop: 12 }, postCopy: { gap: 4 }, postTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14, lineHeight: 20 }, postText: { color: theme.text, fontFamily: theme.font.body, fontSize: 14, lineHeight: 20 }, detailText: { fontSize: 16, lineHeight: 23 },
  structuredPanel: { backgroundColor: theme.surfaceMuted, borderColor: theme.border, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginTop: 3, padding: 10 }, structuredEyebrow: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 9, letterSpacing: 0.7, marginBottom: 4 }, urgent: { color: theme.statusAttention, fontFamily: theme.font.semibold, fontSize: 11, marginTop: 7 },
  pollCard: { marginTop: 11, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, borderRadius: 16, padding: 12, backgroundColor: theme.surface, gap: 10 },
  pollTopline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  pollBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.surfaceMuted },
  pollBadgeText: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 10.5 },
  pollClosed: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 10.5 },
  pollOptions: { gap: 8 },
  pollOption: { minHeight: 50, borderWidth: 1, borderColor: theme.border, borderRadius: 13, overflow: "hidden", justifyContent: "center", backgroundColor: theme.canvas },
  pollOptionSelected: { borderColor: theme.deepBrand, borderWidth: 1.5 },
  pollOptionFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: theme.surfaceSoft },
  pollOptionContent: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 9 },
  pollRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: theme.textSubtle, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface },
  pollRadioSelected: { borderColor: theme.deepBrand, backgroundColor: theme.deepBrand },
  pollOptionLabel: { flex: 1, color: theme.text, fontFamily: theme.font.medium, fontSize: 13, lineHeight: 18 },
  pollPercent: { color: theme.text, fontFamily: theme.font.bold, fontSize: 12 },
  pollFooter: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  pollMeta: { flex: 1, color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5 },
  pollDetails: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 2 },
  pollDetailsText: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 10.5 },
  postImage: { width: "100%", aspectRatio: 1.5, borderRadius: 12, marginTop: 8 }, correction: { flexDirection: "row", alignItems: "flex-start", gap: 7, backgroundColor: theme.surfaceMuted, borderRadius: 10, marginTop: 8, padding: 9 }, correctionText: { color: theme.statusAttention, flex: 1, fontFamily: theme.font.medium, fontSize: 11, lineHeight: 16 },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginLeft: 47, minHeight: 44, flexWrap: "wrap" }, fullActions: { marginLeft: 0 }, action: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 44, minWidth: 44 }, actionText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11 }, pressed: { opacity: 0.7 },
  detailMeta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border, paddingVertical: 3, marginTop: 10 }, exactTime: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11 }, sponsored: { color: theme.textSubtle, fontFamily: theme.font.bold, fontSize: 8, letterSpacing: 0.8, marginLeft: 47 }, repostedBy: { flexDirection: "row", gap: 5, marginLeft: 47, marginBottom: 7, alignItems: "center" }, repostedText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11, flex: 1 },
});
