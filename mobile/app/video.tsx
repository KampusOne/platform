import { useEvent } from "expo";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { VideoView, useVideoPlayer } from "expo-video";
import { api, ApiError } from "@/src/lib/api";
import { useAppearance } from "@/src/lib/appearance";
import { ProfileAvatar } from "@/src/components/profile-avatar";
import { VerifiedBadge } from "@/src/components/verified-badge";
import { PostLinkDialog } from "@/src/components/post-menu";
import { validPostId, sharePostLink } from "@/src/lib/feed-posts";
import { compactCount } from "@/src/lib/feed-time";
import { safeCount, type SocialFeedPost } from "@/src/lib/feed-social";
import {
  readVideoPlaybackSession,
  writeVideoPlaybackSession,
} from "@/src/lib/video-playback-session";

const speeds = [1, 1.25, 1.5, 2] as const;

type PersonResponse = {
  profile: {
    user_id: string;
    display_name: string;
    username: string | null;
    profile_image_url: string | null;
    verified: boolean;
    followed: boolean;
    follower_count: number;
  };
  isOwner: boolean;
};

function formatClock(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const whole = Math.floor(value);
  return String(Math.floor(whole / 60)) + ":" + String(whole % 60).padStart(2, "0");
}

function actionLabel(count: number) {
  return count > 0 ? compactCount(count) : "";
}

export default function VideoViewerScreen() {
  const { theme } = useAppearance();
  const { height, width } = useWindowDimensions();
  const params = useLocalSearchParams<{
    id?: string | string[];
    position?: string;
    muted?: string;
  }>();
  const id = validPostId(params.id) ? params.id : "";
  const requestedPosition = Math.max(0, Number(params.position ?? 0) || 0);
  const requestedMuted = params.muted !== "0";
  const [post, setPost] = useState<SocialFeedPost | null>(null);
  const [person, setPerson] = useState<PersonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyId, setCopyId] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [position, setPosition] = useState(requestedPosition);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<(typeof speeds)[number]>(1);
  const [trackWidth, setTrackWidth] = useState(0);
  const videoRef = useRef<VideoView>(null);
  const focused = useRef(false);
  const shouldResume = useRef(true);
  const sourceVersion = useRef(0);

  const player = useVideoPlayer(null, (instance) => {
    instance.loop = false;
    instance.muted = requestedMuted;
    instance.playbackRate = 1;
  });

  const playingEvent = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });
  const mutedEvent = useEvent(player, "mutedChange", {
    muted: player.muted,
  });
  const statusEvent = useEvent(player, "statusChange", {
    status: player.status,
  });
  const isPlaying = playingEvent?.isPlaying ?? player.playing;
  const isMuted = mutedEvent?.muted ?? player.muted;
  const status = statusEvent?.status ?? player.status;
  const playerError = statusEvent?.error;

  useEffect(() => {
    let live = true;
    if (!id) {
      setLoading(false);
      setError("This video link is not valid.");
      return () => { live = false; };
    }
    setLoading(true);
    setError("");
    void api<{ post: SocialFeedPost }>("/v1/student/feed/" + id)
      .then(({ post: next }) => {
        if (!live) return;
        if (!next.image_url || !(next.media_type === "video" || next.media_type?.startsWith("video/"))) {
          throw new Error("This post does not contain a playable video.");
        }
        setPost(next);
        if (next.source_user_id) {
          void api<PersonResponse>("/v1/people/" + next.source_user_id)
            .then((profile) => { if (live) setPerson(profile); })
            .catch(() => undefined);
        }
      })
      .catch((caught) => {
        if (!live) return;
        setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : "This video could not load.");
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id]);

  useEffect(() => {
    if (!post?.image_url) return;
    const version = ++sourceVersion.current;
    const remembered = readVideoPlaybackSession(post.id);
    const startAt = remembered?.position ?? requestedPosition;
    const startMuted = remembered?.muted ?? requestedMuted;
    void player.replaceAsync(post.image_url).then(() => {
      if (version !== sourceVersion.current) return;
      player.currentTime = Math.max(0, startAt);
      player.muted = startMuted;
      player.playbackRate = speed;
      shouldResume.current = true;
      if (focused.current) player.play();
    }).catch((caught) => {
      if (version === sourceVersion.current) setError(caught instanceof Error ? caught.message : "This video could not load.");
    });
  }, [player, post?.id, post?.image_url, requestedMuted, requestedPosition]);

  useEffect(() => {
    const update = () => {
      const nextPosition = Number(player.currentTime);
      const nextDuration = Number(player.duration);
      if (Number.isFinite(nextPosition)) {
        const safePosition = Math.max(0, nextPosition);
        setPosition(safePosition);
        if (post?.id && (player.playing || focused.current)) {
          writeVideoPlaybackSession(post.id, safePosition, player.muted);
        }
      }
      if (Number.isFinite(nextDuration)) setDuration(Math.max(0, nextDuration));
    };
    update();
    const timer = setInterval(update, 250);
    return () => {
      clearInterval(timer);
      if (post?.id) writeVideoPlaybackSession(post.id, Number(player.currentTime) || 0, player.muted);
    };
  }, [player, post?.id]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    if (post?.image_url && shouldResume.current) player.play();
    return () => {
      focused.current = false;
      shouldResume.current = player.playing;
      if (post?.id) writeVideoPlaybackSession(post.id, Number(player.currentTime) || 0, player.muted);
      player.pause();
    };
  }, [player, post?.id, post?.image_url]));

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (focused.current && shouldResume.current && post?.image_url) player.play();
        return;
      }
      shouldResume.current = player.playing;
      if (post?.id) writeVideoPlaybackSession(post.id, Number(player.currentTime) || 0, player.muted);
      player.pause();
    });
    return () => subscription.remove();
  }, [player, post?.id, post?.image_url]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const progress = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
  const description = useMemo(() => {
    if (!post) return "";
    return post.body || post.summary || post.title || "";
  }, [post]);

  function togglePlayback() {
    if (isPlaying) {
      shouldResume.current = false;
      player.pause();
    } else {
      shouldResume.current = true;
      if (duration > 0 && position >= duration - 0.15) player.currentTime = 0;
      player.play();
    }
  }

  function cycleSpeed() {
    const index = speeds.indexOf(speed);
    const next = speeds[(index + 1) % speeds.length] ?? 1;
    player.playbackRate = next;
    setSpeed(next);
  }

  function seekFromTrack(locationX: number) {
    if (!trackWidth || !duration) return;
    const next = Math.max(0, Math.min(duration, (locationX / trackWidth) * duration));
    player.currentTime = next;
    setPosition(next);
    if (post?.id) writeVideoPlaybackSession(post.id, next, player.muted);
  }

  async function toggleLike() {
    if (!post || busy) return;
    const before = post;
    const nextLiked = !Boolean(post.liked);
    setBusy("like");
    setPost({ ...post, liked: nextLiked, like_count: Math.max(0, safeCount(post.like_count) + (nextLiked ? 1 : -1)) });
    try {
      const result = await api<{ liked: boolean; like_count: number }>("/v1/student/feed/" + post.id + "/like", { method: nextLiked ? "PUT" : "DELETE" });
      setPost((current) => current ? { ...current, liked: result.liked, like_count: result.like_count } : current);
    } catch (caught) {
      setPost(before);
      setNotice(caught instanceof Error ? caught.message : "Your like could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function toggleRepost() {
    if (!post || busy) return;
    const before = post;
    const next = !Boolean(post.reposted);
    setBusy("repost");
    setPost({ ...post, reposted: next, repost_count: Math.max(0, safeCount(post.repost_count) + (next ? 1 : -1)) });
    try {
      const result = await api<{ reposted: boolean; post?: SocialFeedPost }>("/v1/student/feed/" + post.id + "/repost", { method: next ? "PUT" : "DELETE" });
      setPost((current) => result.post ?? (current ? { ...current, reposted: result.reposted } : current));
    } catch (caught) {
      setPost(before);
      setNotice(caught instanceof Error ? caught.message : "Your repost could not be updated.");
    } finally {
      setBusy("");
    }
  }

  async function toggleBookmark() {
    if (!post || busy) return;
    const before = post;
    const next = !post.bookmarked;
    setBusy("bookmark");
    setPost({ ...post, bookmarked: next });
    try {
      await api("/v1/student/feed/" + post.id + "/bookmark", { method: next ? "PUT" : "DELETE" });
    } catch (caught) {
      setPost(before);
      setNotice(caught instanceof Error ? caught.message : "Saved posts could not be updated.");
    } finally {
      setBusy("");
    }
  }

  async function share() {
    if (!post) return;
    try {
      const result = await sharePostLink(post);
      if (result === "copied") setNotice("Post link copied.");
      if (result === "manual") setCopyId(post.id);
    } catch {
      setNotice("The share menu could not open.");
    }
  }

  async function toggleFollow() {
    if (!post?.source_user_id || !person || person.isOwner || busy) return;
    const before = person;
    const next = !person.profile.followed;
    setBusy("follow");
    setPerson({
      ...person,
      profile: {
        ...person.profile,
        followed: next,
        follower_count: Math.max(0, safeCount(person.profile.follower_count) + (next ? 1 : -1)),
      },
    });
    try {
      const result = await api<{ followed: boolean; follower_count: number }>("/v1/people/" + post.source_user_id + "/follow", {
        method: "PUT",
        body: JSON.stringify({ follow: next }),
      });
      setPerson((current) => current ? { ...current, profile: { ...current.profile, ...result } } : current);
    } catch (caught) {
      setPerson(before);
      setNotice(caught instanceof Error ? caught.message : "Follow could not be updated.");
    } finally {
      setBusy("");
    }
  }

  const mediaHeight = Math.max(260, Math.min(height * 0.53, width * 0.95));

  if (loading && !post) {
    return <SafeAreaView style={styles.screen}><StatusBar style="light" /><View style={styles.center}><Text style={[styles.stateText, { fontFamily: theme.font.medium }]}>Opening video…</Text></View></SafeAreaView>;
  }

  if (!post || error) {
    return <SafeAreaView style={styles.screen}><StatusBar style="light" /><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/feed")} style={styles.headerButton}><Ionicons name="arrow-back" color="#FFFFFF" size={27} /></Pressable></View><View style={styles.center}><Text style={[styles.stateText, { fontFamily: theme.font.medium }]}>{error || "This video is unavailable."}</Text></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/feed")} style={styles.headerButton}>
          <Ionicons name="arrow-back" color="#FFFFFF" size={27} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Video options" onPress={() => setMenuOpen(true)} style={styles.headerButton}>
          <Ionicons name="ellipsis-vertical" color="#FFFFFF" size={25} />
        </Pressable>
      </View>

      <View style={[styles.mediaStage, { height: mediaHeight }]}>
        <VideoView
          ref={videoRef}
          accessibilityLabel="Post video"
          player={player}
          nativeControls={false}
          contentFit="contain"
          surfaceType="textureView"
          style={StyleSheet.absoluteFill}
        />
        {status === "loading" ? <View pointerEvents="none" style={styles.videoState}><Text style={[styles.videoStateText, { fontFamily: theme.font.medium }]}>Loading video…</Text></View> : null}
        {status === "error" ? <View pointerEvents="none" style={styles.videoState}><Ionicons name="alert-circle-outline" color="#FFFFFF" size={28} /><Text style={[styles.videoStateText, { fontFamily: theme.font.medium }]}>{playerError?.message || "This video could not play."}</Text></View> : null}
      </View>

      <View style={styles.meta}>
        <View style={styles.authorRow}>
          <Pressable accessibilityRole="button" disabled={!post.source_user_id} onPress={() => post.source_user_id && router.push({ pathname: "/student-profile", params: { id: post.source_user_id } })} style={styles.authorIdentity}>
            <ProfileAvatar name={post.source_name} imageUrl={post.source_image_url} size={48} />
            <View style={styles.authorCopy}>
              <View style={styles.nameRow}>
                <Text numberOfLines={1} style={[styles.authorName, { fontFamily: theme.font.semibold }]}>{post.source_name}</Text>
                {post.source_verified ? <VerifiedBadge size={15} /> : null}
              </View>
              {post.source_username ? <Text numberOfLines={1} style={[styles.username, { fontFamily: theme.font.body }]}>@{post.source_username}</Text> : null}
            </View>
          </Pressable>
          {person && !person.isOwner ? (
            <Pressable accessibilityRole="button" accessibilityState={{ selected: person.profile.followed, busy: busy === "follow" }} disabled={busy === "follow"} onPress={() => void toggleFollow()} style={[styles.followButton, person.profile.followed && styles.followingButton]}>
              <Text style={[styles.followText, { fontFamily: theme.font.semibold }]}>{person.profile.followed ? "Following" : "Follow"}</Text>
            </Pressable>
          ) : null}
        </View>

        {description ? <Text numberOfLines={2} style={[styles.description, { fontFamily: theme.font.body }]}>{description}</Text> : null}

        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel={String(safeCount(post.comment_count)) + " comments"} onPress={() => router.push({ pathname: "/post", params: { id: post.id, comments: "1" } })} style={styles.actionButton}>
            <Ionicons name="chatbubble-outline" size={23} color="#FFFFFF" />
            {safeCount(post.comment_count) ? <Text style={[styles.actionCount, { fontFamily: theme.font.medium }]}>{actionLabel(safeCount(post.comment_count))}</Text> : null}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(post.reposted), busy: busy === "repost" }} disabled={busy === "repost"} onPress={() => void toggleRepost()} style={styles.actionButton}>
            <Ionicons name="repeat-outline" size={24} color={post.reposted ? "#E8A27D" : "#FFFFFF"} />
            {safeCount(post.repost_count) ? <Text style={[styles.actionCount, { fontFamily: theme.font.medium }]}>{actionLabel(safeCount(post.repost_count))}</Text> : null}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(post.liked), busy: busy === "like" }} disabled={busy === "like"} onPress={() => void toggleLike()} style={styles.actionButton}>
            <Ionicons name={post.liked ? "heart" : "heart-outline"} size={24} color={post.liked ? "#E8A27D" : "#FFFFFF"} />
            {safeCount(post.like_count) ? <Text style={[styles.actionCount, { fontFamily: theme.font.medium }]}>{actionLabel(safeCount(post.like_count))}</Text> : null}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: post.bookmarked, busy: busy === "bookmark" }} disabled={busy === "bookmark"} onPress={() => void toggleBookmark()} style={styles.iconAction}>
            <Ionicons name={post.bookmarked ? "bookmark" : "bookmark-outline"} size={23} color={post.bookmarked ? "#E8A27D" : "#FFFFFF"} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Share video" onPress={() => void share()} style={styles.iconAction}>
            <Ionicons name="share-social-outline" size={23} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      <View style={styles.playbackDock}>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Video progress"
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
          onPress={(event) => seekFromTrack(event.nativeEvent.locationX)}
          style={styles.progressTouch}
        >
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: String(progress * 100) + "%" }]} /></View>
        </Pressable>
        <View style={styles.controls}>
          <Pressable accessibilityRole="button" accessibilityLabel={isPlaying ? "Pause video" : "Play video"} onPress={togglePlayback} style={styles.controlButton}>
            <Ionicons name={isPlaying ? "pause" : "play"} size={34} color="#FFFFFF" />
          </Pressable>
          <Text style={[styles.remaining, { fontFamily: theme.font.medium }]}>-{formatClock(Math.max(0, duration - position))}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={"Playback speed " + String(speed) + " times"} onPress={cycleSpeed} style={styles.controlButton}>
            <Text style={[styles.speed, { fontFamily: theme.font.semibold }]}>{speed}x</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={isMuted ? "Unmute video" : "Mute video"} onPress={() => { player.muted = !isMuted; writeVideoPlaybackSession(post.id, position, !isMuted); }} style={styles.controlButton}>
            <Ionicons name={isMuted ? "volume-mute-outline" : "volume-high-outline"} size={28} color="#FFFFFF" />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Use native full screen" onPress={() => void videoRef.current?.enterFullscreen()} style={styles.controlButton}>
            <Ionicons name="expand-outline" size={27} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      {notice ? <View pointerEvents="none" style={styles.notice}><Text style={[styles.noticeText, { fontFamily: theme.font.medium }]}>{notice}</Text></View> : null}

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close video options" onPress={() => setMenuOpen(false)} style={StyleSheet.absoluteFill} />
          <View style={styles.menu}>
            <Text style={[styles.menuTitle, { fontFamily: theme.font.semibold }]}>Video options</Text>
            <Pressable accessibilityRole="button" onPress={() => { setMenuOpen(false); void toggleBookmark(); }} style={styles.menuRow}><Ionicons name={post.bookmarked ? "bookmark" : "bookmark-outline"} color="#FFFFFF" size={21} /><Text style={[styles.menuText, { fontFamily: theme.font.medium }]}>{post.bookmarked ? "Remove from saved" : "Save video post"}</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => { setMenuOpen(false); void share(); }} style={styles.menuRow}><Ionicons name="share-social-outline" color="#FFFFFF" size={21} /><Text style={[styles.menuText, { fontFamily: theme.font.medium }]}>Share post</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => { setMenuOpen(false); router.push({ pathname: "/post", params: { id: post.id } }); }} style={styles.menuRow}><Ionicons name="reader-outline" color="#FFFFFF" size={21} /><Text style={[styles.menuText, { fontFamily: theme.font.medium }]}>Open full post</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => setMenuOpen(false)} style={styles.menuRow}><Ionicons name="close-outline" color="#AEB4BA" size={21} /><Text style={[styles.menuText, { color: "#AEB4BA", fontFamily: theme.font.medium }]}>Close</Text></Pressable>
          </View>
        </View>
      </Modal>
      <PostLinkDialog id={copyId} onClose={() => setCopyId(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  header: { minHeight: 62, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 4 },
  headerButton: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#1B242C" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  stateText: { color: "#FFFFFF", fontSize: 14, textAlign: "center" },
  mediaStage: { width: "100%", backgroundColor: "#000000", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  videoState: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 9, backgroundColor: "rgba(0,0,0,0.42)" },
  videoStateText: { color: "#FFFFFF", fontSize: 13 },
  meta: { paddingHorizontal: 22, paddingTop: 16, paddingBottom: 12, gap: 12 },
  authorRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  authorIdentity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 },
  authorCopy: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  authorName: { color: "#FFFFFF", fontSize: 18, flexShrink: 1 },
  username: { color: "#AEB4BA", fontSize: 13, marginTop: 2 },
  followButton: { minHeight: 44, minWidth: 98, paddingHorizontal: 18, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#202830" },
  followingButton: { borderWidth: 1, borderColor: "#5C656D", backgroundColor: "transparent" },
  followText: { color: "#FFFFFF", fontSize: 14 },
  description: { color: "#FFFFFF", fontSize: 15, lineHeight: 21 },
  actions: { flexDirection: "row", alignItems: "center", gap: 12 },
  actionButton: { minHeight: 54, minWidth: 78, paddingHorizontal: 16, borderRadius: 28, backgroundColor: "#202830", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  iconAction: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#202830", alignItems: "center", justifyContent: "center" },
  actionCount: { color: "#FFFFFF", fontSize: 14 },
  playbackDock: { marginTop: "auto", paddingHorizontal: 0, paddingBottom: 4 },
  progressTouch: { minHeight: 25, justifyContent: "center" },
  progressTrack: { height: 4, backgroundColor: "#3C3C3C", overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#FFFFFF" },
  controls: { minHeight: 78, paddingHorizontal: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  controlButton: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  remaining: { color: "#FFFFFF", fontSize: 16 },
  speed: { color: "#FFFFFF", fontSize: 17 },
  notice: { position: "absolute", left: 18, right: 18, bottom: 108, alignItems: "center" },
  noticeText: { color: "#FFFFFF", backgroundColor: "rgba(27,36,44,0.96)", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 11, fontSize: 12.5, overflow: "hidden" },
  modalRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)", padding: 14 },
  menu: { width: "100%", maxWidth: 540, alignSelf: "center", backgroundColor: "#11171C", borderRadius: 22, padding: 16, borderWidth: 1, borderColor: "#2B353D" },
  menuTitle: { color: "#FFFFFF", fontSize: 18, paddingHorizontal: 8, paddingBottom: 8 },
  menuRow: { minHeight: 52, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 13 },
  menuText: { color: "#FFFFFF", fontSize: 14 },
});
