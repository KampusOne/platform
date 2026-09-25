import { MediaPreview } from "./media-preview";
import { router } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { getFeedPostText } from "@/src/lib/feed-post-text";
import { wasPostDeleted } from "@/src/lib/feed-posts";
import type { QuotedPost } from "@/src/lib/feed-social";
import { VerifiedBadge } from "./verified-badge";
import { RelativeTime } from "./relative-time";

export function QuotedPostPreview({ post, unavailable = false }: { post: QuotedPost | null; unavailable?: boolean }) {
  const { styles } = useThemeStyles(createStyles);
  if (!post || unavailable || wasPostDeleted(post.id)) return <View style={styles.card}><Text style={styles.muted}>Original post unavailable</Text></View>;
  const text = getFeedPostText(post);
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open original post by ${post.source_name}${post.source_verified ? ", verified" : ""}`} onPress={(event) => { event.stopPropagation(); router.push({ pathname: "/post", params: { id: post.id } }); }} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    <View style={styles.author}><Text numberOfLines={1} style={styles.name}>{post.source_name}</Text>{post.source_verified ? <VerifiedBadge size={12} /> : null}<Text style={styles.muted}>·</Text><RelativeTime value={post.published_at} style={styles.muted} /></View>
    {text.title ? <Text numberOfLines={2} style={styles.title}>{text.title}</Text> : null}
    {text.paragraphs.length ? <Text numberOfLines={5} style={styles.body}>{text.paragraphs.join("\n\n")}</Text> : null}
    {post.image_url ? post.media_type?.startsWith("video/") ? <MediaPreview url={post.image_url} video label="Quoted video"/> : <Image source={{ uri: post.image_url }} accessibilityLabel="Original post attachment" resizeMode="cover" style={styles.image} /> : null}
  </Pressable>;
}
const createStyles = (theme: Theme) => StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, borderRadius: 12, padding: 10, gap: 5, marginTop: 8 }, author: { flexDirection: "row", alignItems: "center", gap: 4 }, name: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12, flexShrink: 1 }, title: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13, lineHeight: 18 }, body: { color: theme.text, fontFamily: theme.font.body, fontSize: 13, lineHeight: 19 }, muted: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10, lineHeight: 16 }, image: { width: "100%", aspectRatio: 2, borderRadius: 8, marginTop: 3 }, pressed: { opacity: 0.72 },
});
