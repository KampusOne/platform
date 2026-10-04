import { useEvent } from "expo";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
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
import { safeCount, type FeedComment, type SocialFeedPost } from "@/src/lib/feed-social";
import {
  readVideoPlaybackSession,
  writeVideoPlaybackSession,
} from "@/src/lib/video-playback-session";
import { CommentThread } from "@/src/components/comment-thread";
import { ReplyComposer } from "@/src/components/reply-composer";
import { useAuth } from "@/src/auth/auth-context";
import { createVideoPlaybackLifecycle } from "@/src/lib/video-playback-lifecycle";
import { createNativeMediaLifetime } from "@/src/lib/native-media-lifetime";
import { postVideoSource } from "@/src/lib/video-source";

const speeds = [1, 1.25, 1.5, 2] as const;
// Expo's web VideoView maps styles directly to DOM CSS. Keep this unregistered
// and explicit so the video fills its stage rather than its intrinsic dimensions.
const videoSurfaceStyle = { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0, width: "100%" as const, height: "100%" as const };

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

function trustedVideoUrl(value: string | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    const allowed =
      url.protocol === "https:" &&
      url.pathname.startsWith("/v1/media/") &&
      (url.hostname === "kampusone.app" ||
        url.hostname.endsWith(".kampusone.app") ||
        url.hostname.endsWith(".vercel.app") ||
        url.hostname.endsWith(".workers.dev"));
    return allowed ? url.toString() : "";
  } catch {
    return "";
  }
}

export default function VideoViewerScreen() {
  const { theme } = useAppearance();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{
    id?: string | string[];
    position?: string;
    muted?: string;
    url?: string;
  }>();
  const id = validPostId(params.id) ? params.id : "";
  const requestedPosition = Math.max(0, Number(params.position ?? 0) || 0);
  const requestedMuted = params.muted !== "0";
  const requestedVideoUrl = trustedVideoUrl(
    typeof params.url === "string" ? params.url : undefined,
  );
  const [post, setPost] = useState<SocialFeedPost | null>(null);
  const [person, setPerson] = useState<PersonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentRefresh, setCommentRefresh] = useState(0);
  const [composer, setComposer] = useState<FeedComment | null | undefined>(undefined);
  const [copyId, setCopyId] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [position, setPosition] = useState(requestedPosition);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<(typeof speeds)[number]>(1);
  const [trackWidth, setTrackWidth] = useState(0);
  const playbackSnapshot = useRef({ position: requestedPosition, muted: requestedMuted });
  const videoRef = useRef<VideoView>(null);
  const focused = useRef(false);
  const shouldResume = useRef(true);
  const appActive = useRef(AppState.currentState === "active");
  const lifecycle = useRef(createVideoPlaybackLifecycle());
  const initialSeek = useRef<{ version: number; position: number } | null>(null);
  const [replacementComplete, setReplacementComplete] = useState(false);
  const playbackKey = post?.id || id;
  const mediaSource = post ? postVideoSource(post) : requestedVideoUrl;

  // Expo's web replaceAsync calls play() itself and discards the browser promise.
  // Initialising a web player with its source avoids that implicit autoplay.
  const player = useVideoPlayer(Platform.OS === "web" ? mediaSource || null : null, (instance) => {
    instance.loop = false;
    instance.muted = requestedMuted;
    instance.playbackRate = 1;
  });
  const lifetime = useMemo(() => createNativeMediaLifetime(), [player]);
  useLayoutEffect(() => { lifetime.activate(); return () => lifetime.dispose(); }, [lifetime]);

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
  const playIfReady = useCallback(() => {
    if (!lifetime.isActive()) return;
    if (!lifecycle.current.canPlay({ focused: focused.current, active: appActive.current, wantsToPlay: shouldResume.current, status: player.status })) return;
    const version = lifecycle.current.currentVersion();
    const start = initialSeek.current;
    try {
      if (start?.version === version) {
        player.currentTime = Math.max(0, start.position);
        initialSeek.current = null;
      }
      if (Platform.OS === "web") {
        // The SDK exposes this element via VideoView's web nativeRef. Its public
        // play() method returns void, so handle the actual browser promise here.
        const video = videoRef.current?.nativeRef.current as HTMLVideoElement | null | undefined;
        if (!video || video.readyState < 3 || !video.paused) return;
        void video.play().catch((caught: unknown) => {
          if (!lifetime.isActive() || version !== lifecycle.current.currentVersion() || !focused.current || !appActive.current) return;
          if (caught instanceof Error && caught.name === "AbortError") return; // This operation was paused/replaced.
          shouldResume.current = false;
          setNotice(caught instanceof Error && caught.name === "NotAllowedError" ? "Tap Play to start this video." : "This video could not play. Try again.");
        });
      } else if (!player.playing) player.play();
    } catch {
      setNotice("This video could not play. Try again.");
    }
  }, [player, lifetime]);

  useEffect(() => {
    let live = true;
    if (!id) {
      setLoading(false);
      setError("This video link is not valid.");
      return () => { live = false; };
    }
    setLoading(true);
    setError("");
    setPost(null);
    setPerson(null);
    void api<{ post: SocialFeedPost }>("/v1/student/feed/" + id)
      .then(({ post: next }) => {
        if (!live) return;
        if (!postVideoSource(next)) {
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
    if (!lifetime.isActive()) return;
    const version = lifecycle.current.beginSource();
    setReplacementComplete(false);
    if (!mediaSource) { player.pause(); return () => lifecycle.current.invalidate(version); }
    const remembered = readVideoPlaybackSession(playbackKey);
    const startAt = remembered?.position ?? requestedPosition;
    const startMuted = remembered?.muted ?? requestedMuted;
    player.pause();
    shouldResume.current = true;
    initialSeek.current = { version, position: startAt };
    const replace = Platform.OS === "web" ? Promise.resolve() : player.replaceAsync(mediaSource);
    void replace.then(() => {
      if (!lifetime.isActive() || !lifecycle.current.completeSource(version)) return;
      player.muted = startMuted;
      player.playbackRate = speed;
      setReplacementComplete(true);
      playIfReady();
    }).catch(() => {
      if (lifetime.isActive() && version === lifecycle.current.currentVersion()) setError("This video could not load. Try opening it again.");
    });
    return () => { lifecycle.current.invalidate(version); lifetime.run(() => player.pause()); };
  }, [
    player,
    mediaSource,
    playbackKey,
    requestedMuted,
    requestedPosition,
    playIfReady,
    lifetime,
  ]);
  useEffect(() => { if (replacementComplete && status === "readyToPlay") playIfReady(); }, [replacementComplete, status, playIfReady]);

  useEffect(() => {
    const update = () => {
      if (!lifetime.isActive()) return;
      const nextPosition = Number(player.currentTime);
      const nextDuration = Number(player.duration);
      if (Number.isFinite(nextPosition)) {
        const safePosition = Math.max(0, nextPosition);
        playbackSnapshot.current = { position: safePosition, muted: player.muted };
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
      if (post?.id) writeVideoPlaybackSession(post.id, playbackSnapshot.current.position, playbackSnapshot.current.muted);
    };
  }, [player, post?.id, lifetime]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    playIfReady();
    return () => {
      focused.current = false;
      lifetime.run(() => { playbackSnapshot.current = { position: Number(player.currentTime) || 0, muted: player.muted }; player.pause(); });
      if (post?.id) writeVideoPlaybackSession(post.id, playbackSnapshot.current.position, playbackSnapshot.current.muted);
    };
  }, [player, post?.id, playIfReady, lifetime]));

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (!lifetime.isActive()) return;
      appActive.current = state === "active";
      if (state === "active") {
        playIfReady();
        return;
      }
      if (post?.id) writeVideoPlaybackSession(post.id, Number(player.currentTime) || 0, player.muted);
      player.pause();
    });
    return () => subscription.remove();
  }, [player, post?.id, playIfReady, lifetime]);

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
    if (!lifetime.isActive()) return;
    if (isPlaying) {
      shouldResume.current = false;
      player.pause();
    } else {
      if (!replacementComplete || player.status !== "readyToPlay") return;
      shouldResume.current = true;
      if (duration > 0 && position >= duration - 0.15) player.currentTime = 0;
      playIfReady();
    }
  }

  function cycleSpeed() {
    if (!lifetime.isActive()) return;
    const index = speeds.indexOf(speed);
    const next = speeds[(index + 1) % speeds.length] ?? 1;
    player.playbackRate = next;
    setSpeed(next);
  }

  function seekFromTrack(locationX: number) {
    if (!lifetime.isActive() || !replacementComplete || player.status !== "readyToPlay" || !trackWidth || !duration) return;
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


  if (loading && !post) {
    return <SafeAreaView style={styles.screen}><StatusBar style="light" /><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/feed")} style={styles.headerButton}><Ionicons name="arrow-back" color="#FFFFFF" size={27} /></Pressable></View><View style={styles.preloadStage}>{mediaSource ? <VideoView ref={videoRef} accessibilityLabel="Post video" player={player} nativeControls={false} playsInline contentFit="contain" surfaceType="textureView" style={videoSurfaceStyle} /> : null}{!mediaSource || !replacementComplete || status === "loading" || status === "idle" ? <View pointerEvents="none" style={styles.videoState}><Text style={[styles.videoStateText, { fontFamily: theme.font.medium }]}>{mediaSource ? "Loading video…" : "Opening video…"}</Text></View> : null}</View></SafeAreaView>;
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

      <View style={styles.mediaStage}>
        <VideoView
          ref={videoRef}
          accessibilityLabel="Post video"
          player={player}
          nativeControls={false}
          playsInline
          contentFit="contain"
          surfaceType="textureView"
          style={videoSurfaceStyle}
        />
        {!replacementComplete || status === "loading" || status === "idle" ? <View pointerEvents="none" style={styles.videoState}><Text style={[styles.videoStateText, { fontFamily: theme.font.medium }]}>Loading video…</Text></View> : null}
        {status === "error" ? <View pointerEvents="none" style={styles.videoState}><Ionicons name="alert-circle-outline" color="#FFFFFF" size={28} /><Text style={[styles.videoStateText, { fontFamily: theme.font.medium }]}>{playerError?.message || "This video could not play."}</Text></View> : null}
        <View style={styles.playbackOverlay}>
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel="Video progress"
            onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
            onPress={(event) => seekFromTrack(event.nativeEvent.locationX)}
            style={styles.progressTouch}
          >
            <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress * 100}%` as `${number}%` }]} /></View>
          </Pressable>
          <View style={styles.controls}>
            <Pressable accessibilityRole="button" accessibilityLabel={isPlaying ? "Pause video" : "Play video"} accessibilityState={{ disabled: !isPlaying && (!replacementComplete || status !== "readyToPlay") }} disabled={!isPlaying && (!replacementComplete || status !== "readyToPlay")} onPress={togglePlayback} style={styles.controlButton}>
              <Ionicons name={isPlaying ? "pause" : "play"} size={31} color="#FFFFFF" />
            </Pressable>
            <Text style={[styles.remaining, { fontFamily: theme.font.medium }]}>-{formatClock(Math.max(0, duration - position))}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={"Playback speed " + String(speed) + " times"} onPress={cycleSpeed} style={styles.controlButton}>
              <Text style={[styles.speed, { fontFamily: theme.font.semibold }]}>{speed}x</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={isMuted ? "Unmute video" : "Mute video"} onPress={() => { if (!lifetime.isActive()) return; player.muted = !isMuted; writeVideoPlaybackSession(post.id, position, !isMuted); }} style={styles.controlButton}>
              <Ionicons name={isMuted ? "volume-mute-outline" : "volume-high-outline"} size={25} color="#FFFFFF" />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Use native full screen" onPress={() => void videoRef.current?.enterFullscreen()} style={styles.controlButton}>
              <Ionicons name="expand-outline" size={25} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
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
          <Pressable accessibilityRole="button" accessibilityLabel={String(safeCount(post.comment_count)) + " comments"} onPress={() => setCommentsOpen(true)} style={styles.actionButton}>
            <Ionicons name="chatbubble-outline" size={23} color="#FFFFFF" />
            {safeCount(post.comment_count) ? <Text style={[styles.actionCount, { fontFamily: theme.font.medium }]}>{actionLabel(safeCount(post.comment_count))}</Text> : null}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(post.reposted), busy: busy === "repost" }} disabled={busy === "repost"} onPress={() => void toggleRepost()} style={styles.actionButton}>
            <Ionicons name="repeat-outline" size={24} color={post.reposted ? theme.peach : "#FFFFFF"} />
            {safeCount(post.repost_count) ? <Text style={[styles.actionCount, { fontFamily: theme.font.medium }]}>{actionLabel(safeCount(post.repost_count))}</Text> : null}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(post.liked), busy: busy === "like" }} disabled={busy === "like"} onPress={() => void toggleLike()} style={styles.actionButton}>
            <Ionicons name={post.liked ? "heart" : "heart-outline"} size={24} color={post.liked ? theme.peach : "#FFFFFF"} />
            {safeCount(post.like_count) ? <Text style={[styles.actionCount, { fontFamily: theme.font.medium }]}>{actionLabel(safeCount(post.like_count))}</Text> : null}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: post.bookmarked, busy: busy === "bookmark" }} disabled={busy === "bookmark"} onPress={() => void toggleBookmark()} style={styles.iconAction}>
            <Ionicons name={post.bookmarked ? "bookmark" : "bookmark-outline"} size={23} color={post.bookmarked ? theme.peach : "#FFFFFF"} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Share video" onPress={() => void share()} style={styles.iconAction}>
            <Ionicons name="share-social-outline" size={23} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      {notice ? <View pointerEvents="none" style={styles.notice}><Text style={[styles.noticeText, { fontFamily: theme.font.medium }]}>{notice}</Text></View> : null}

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close video options" onPress={() => setMenuOpen(false)} style={StyleSheet.absoluteFill} />
          <View style={styles.menu}>
            <Text style={[styles.menuTitle, { fontFamily: theme.font.semibold }]}>Video options</Text>
            <Pressable accessibilityRole="button" onPress={() => { setMenuOpen(false); void toggleBookmark(); }} style={styles.menuRow}><Ionicons name={post.bookmarked ? "bookmark" : "bookmark-outline"} color={theme.text} size={21} /><Text style={[styles.menuText, { fontFamily: theme.font.medium }]}>{post.bookmarked ? "Remove from saved" : "Save video post"}</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => { setMenuOpen(false); void share(); }} style={styles.menuRow}><Ionicons name="share-social-outline" color={theme.text} size={21} /><Text style={[styles.menuText, { fontFamily: theme.font.medium }]}>Share post</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => { setMenuOpen(false); router.push({ pathname: "/post", params: { id: post.id } }); }} style={styles.menuRow}><Ionicons name="reader-outline" color={theme.text} size={21} /><Text style={[styles.menuText, { fontFamily: theme.font.medium }]}>Open full post</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => setMenuOpen(false)} style={styles.menuRow}><Ionicons name="close-outline" color={theme.textMuted} size={21} /><Text style={[styles.menuText, { color: theme.textMuted, fontFamily: theme.font.medium }]}>Close</Text></Pressable>
          </View>
        </View>
      </Modal>
      <Modal visible={commentsOpen} transparent animationType="slide" onRequestClose={() => setCommentsOpen(false)}>
        <View style={styles.commentsBackdrop}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close comments" onPress={() => setCommentsOpen(false)} style={StyleSheet.absoluteFill} />
          <SafeAreaView style={styles.commentsSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.commentsHeader}>
              <Text style={[styles.commentsTitle, { fontFamily: theme.font.semibold }]}>Replies</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close replies" onPress={() => setCommentsOpen(false)} style={styles.commentsClose}>
                <Ionicons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.commentsContent}>
              <CommentThread
                postId={post.id}
                refreshToken={commentRefresh}
                onUpdated={() => setCommentRefresh((value) => value + 1)}
                onReply={(comment) => setComposer(comment)}
              />
            </ScrollView>
            <Pressable accessibilityRole="button" accessibilityLabel="Post your reply" onPress={() => setComposer(null)} style={styles.replyBar}>
              <ProfileAvatar name={profile?.display_name ?? "You"} imageUrl={profile?.profile_image_url} size={32} />
              <Text style={[styles.replyPlaceholder, { fontFamily: theme.font.body }]}>Post your reply</Text>
              <Ionicons name="chatbubble-outline" size={20} color={theme.deepBrand} />
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>
      {composer !== undefined ? (
        <ReplyComposer
          post={post}
          parent={composer ?? undefined}
          onClose={() => setComposer(undefined)}
          onSent={() => {
            setCommentRefresh((value) => value + 1);
            setComposer(undefined);
          }}
        />
      ) : null}
      <PostLinkDialog id={copyId} onClose={() => setCopyId(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#000000",
  },
  preloadStage: {
    flex: 1,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    minHeight: 62,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 4,
    backgroundColor: "#000000",
  },
  headerButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(24,31,37,.88)",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  stateText: {
    color: "#FFFFFF",
    fontSize: 14,
    textAlign: "center",
  },
  mediaStage: {
    flex: 1,
    minHeight: 0,
    width: "100%",
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  videoState: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  videoStateText: {
    color: "#FFFFFF",
    fontSize: 13,
  },
  playbackOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,.52)",
  },
  progressTouch: {
    minHeight: 20,
    justifyContent: "flex-end",
  },
  progressTrack: {
    height: 3,
    backgroundColor: "rgba(255,255,255,.28)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#FFFFFF",
  },
  controls: {
    minHeight: 62,
    paddingHorizontal: 19,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  controlButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  remaining: {
    color: "#FFFFFF",
    fontSize: 14,
  },
  speed: {
    color: "#FFFFFF",
    fontSize: 14,
  },
  meta: {
    marginTop: 0,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
    backgroundColor: "#000000",
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  authorIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  authorCopy: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  authorName: {
    color: "#FFFFFF",
    fontSize: 15,
    flexShrink: 1,
  },
  username: {
    color: "#CFCFCF",
    fontSize: 12,
    marginTop: 2,
  },
  followButton: {
    minHeight: 42,
    minWidth: 94,
    paddingHorizontal: 16,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#29231F",
  },
  followingButton: {
    borderWidth: 1,
    borderColor: "#CFC1B6",
    backgroundColor: "transparent",
  },
  followText: {
    color: "#FFFFFF",
    fontSize: 13,
  },
  description: {
    color: "#FFFFFF",
    fontSize: 14,
    lineHeight: 21,
  },
  actions: {
    minHeight: 56,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,.15)",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,.15)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actionButton: {
    flex: 1,
    minHeight: 54,
    minWidth: 0,
    paddingHorizontal: 5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "transparent",
  },
  iconAction: {
    minWidth: 46,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  actionCount: {
    color: "#FFFFFF",
    fontSize: 12,
  },
  notice: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 28,
    alignItems: "center",
  },
  noticeText: {
    color: "#FFFFFF",
    backgroundColor: "rgba(41,35,31,0.94)",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 11,
    fontSize: 12.5,
    overflow: "hidden",
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
    padding: 12,
  },
  menu: {
    width: "100%",
    maxWidth: 540,
    alignSelf: "center",
    backgroundColor: "#FBF7F2",
    borderRadius: 22,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5D9CE",
  },
  menuTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  menuRow: {
    minHeight: 52,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ECE2DA",
  },
  menuText: {
    color: "#29231F",
    fontSize: 14,
  },
  commentsBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,.42)",
  },
  commentsSheet: {
    height: "76%",
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
    backgroundColor: "#FBF7F2",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 48,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#D8CEC6",
    marginTop: 9,
    marginBottom: 5,
  },
  commentsHeader: {
    minHeight: 54,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E6DBD3",
  },
  commentsTitle: {
    color: "#29231F",
    fontSize: 17,
  },
  commentsClose: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  commentsContent: {
    paddingHorizontal: 15,
    paddingBottom: 24,
  },
  replyBar: {
    minHeight: 58,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 29,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "#F1EBE5",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DED3CB",
  },
  replyPlaceholder: {
    flex: 1,
    color: "#756961",
    fontSize: 13,
  },
});
