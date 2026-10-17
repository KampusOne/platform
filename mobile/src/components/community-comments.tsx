import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardModal as Modal, KeyboardScrollView as ScrollView } from './keyboard-viewport';
import { useAuth } from '@/src/auth/auth-context';
import { api } from '@/src/lib/api';
import { useThemeStyles, type Theme } from '@/src/lib/appearance';
import { normalizeGroupComments, type GroupComment, type GroupPost } from '@/src/lib/student-group-state';
import type { SocialFeedPost } from '@/src/lib/feed-social';
import { Ionicons } from '@expo/vector-icons';
import { ProfileAvatar } from './profile-avatar';
import { RelativeTime } from './relative-time';
import { VerifiedBadge } from './verified-badge';
import { ListSkeleton } from './skeleton';
import { ReplyComposer } from './reply-composer';

export function CommunityComments({ groupId, post, admin, onClose, onUpdated }: {
  groupId: string; post: GroupPost; admin: boolean; onClose(): void; onUpdated(): void;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  const { user, profile } = useAuth();
  const [comments, setComments] = useState<GroupComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [writing, setWriting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const version = useRef(0), mutation = useRef(false);
  const path = `/v1/communities/groups/${groupId}/posts/${post.id}/comments`;
  const load = useCallback(async () => {
    const current = ++version.current; setLoading(true); setError('');
    try { const result = await api<unknown>(path); if (version.current === current) setComments(normalizeGroupComments(result)); }
    catch (caught) { if (version.current === current) setError(caught instanceof Error ? caught.message : 'Could not load replies. Try again.'); }
    finally { if (version.current === current) setLoading(false); }
  }, [path]);
  useEffect(() => { void load(); return () => { version.current++; }; }, [load]);
  async function remove(comment: GroupComment) {
    if (mutation.current) return;
    const current = version.current;
    mutation.current = true; setDeleting(comment.id); setError('');
    try {
      await api(`${path}/${comment.id}`, { method: 'DELETE' });
      if (version.current === current) { setComments(rows => rows.filter(row => row.id !== comment.id)); onUpdated(); }
    } catch (caught) { if (version.current === current) setError(caught instanceof Error ? caught.message : 'Your reply could not be deleted.'); }
    finally { mutation.current = false; if (version.current === current) setDeleting(null); }
  }
  const context: SocialFeedPost = {
    id: post.id, category: 'COMMUNITY', title: post.title, summary: post.body, body: post.body,
    image_url: post.media_url, urgent: post.urgent, sponsored: false, published_at: post.created_at,
    correction_note: null, source_name: post.display_name, source_verified: post.verified === true,
    source_badge_kind: post.badge_kind ?? null, source_image_url: post.avatar_url, bookmarked: false,
  };
  return <Modal visible presentationStyle="fullScreen" animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Close community comments" onPress={onClose} style={styles.icon}><Ionicons name="arrow-back" size={23} color={theme.text} /></Pressable><Text accessibilityRole="header" style={styles.heading}>Replies</Text><Pressable accessibilityRole="button" accessibilityLabel="Refresh replies" disabled={loading || Boolean(deleting)} onPress={() => void load()} style={styles.icon}><Ionicons name="refresh-outline" size={20} color={theme.textMuted} /></Pressable></View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.context}><ProfileAvatar name={post.display_name} imageUrl={post.avatar_url} size={36} /><View style={styles.copy}><View style={styles.nameRow}><Text style={styles.name}>{post.display_name}</Text>{post.verified ? <VerifiedBadge kind={post.badge_kind} /> : null}<RelativeTime value={post.created_at} style={styles.time} /></View><Text style={styles.body}>{post.body || post.title}</Text>{post.media_url ? <Image accessibilityLabel="Community post image" source={{ uri: post.media_url }} style={styles.image} /> : null}</View></View>
        {loading && !comments.length ? <ListSkeleton count={3} /> : null}
        {error ? <View style={styles.feedback}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.link}>Try again</Text></Pressable></View> : null}
        {!loading && !error && !comments.length ? <View style={styles.empty}><Ionicons name="chatbubbles-outline" size={30} color={theme.textMuted} /><Text style={styles.name}>Start the conversation</Text><Text style={styles.muted}>Be the first to reply to this post.</Text></View> : null}
        {comments.map(comment => <View key={comment.id} style={styles.comment}>
          <Pressable accessibilityRole="link" accessibilityLabel={`View ${comment.display_name}’s profile`} onPress={() => { onClose(); router.push({ pathname: '/student-profile', params: { id: comment.author_user_id } }); }}><ProfileAvatar name={comment.display_name} imageUrl={comment.avatar_url} size={36} /></Pressable>
          <View style={styles.copy}><View style={styles.nameRow}><Text numberOfLines={1} style={styles.name}>{comment.display_name}</Text>{comment.verified ? <VerifiedBadge kind={comment.badge_kind} /> : null}<RelativeTime value={comment.created_at} style={styles.time} />{comment.author_user_id === user?.id || admin ? <Pressable accessibilityRole="button" accessibilityLabel="Reply options" disabled={Boolean(deleting)} onPress={() => Alert.alert('Delete reply?', 'This removes this reply from the community.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void remove(comment) }])} style={styles.menu}><Ionicons name="ellipsis-horizontal" size={18} color={theme.textMuted} /></Pressable> : null}</View>
          {comment.body ? <Text style={styles.body}>{comment.body}</Text> : null}{comment.media_url ? <Image accessibilityLabel="Reply attachment" source={{ uri: comment.media_url }} style={styles.image} /> : null}{deleting === comment.id ? <Text style={styles.muted}>Deleting…</Text> : null}</View>
        </View>)}
      </ScrollView>
      <View style={styles.dock}><Pressable accessibilityRole="button" accessibilityLabel="Write a community reply" onPress={() => setWriting(true)} style={styles.prompt}><ProfileAvatar name={profile?.display_name || 'You'} imageUrl={profile?.profile_image_url} size={30} /><Text style={[styles.muted, { flex: 1 }]}>Post your reply</Text><Ionicons name="image-outline" size={21} color={theme.accentText} /></Pressable></View>
      {writing ? <ReplyComposer post={context} replyPath={path} onClose={() => setWriting(false)} onSent={() => { void load(); onUpdated(); }} /> : null}
    </SafeAreaView>
  </Modal>;
}
const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas }, header: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border, paddingHorizontal: 8 },
  icon: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' }, heading: { flex: 1, fontFamily: theme.font.semibold, color: theme.text, fontSize: 18 },
  content: { paddingHorizontal: 14, paddingBottom: 24, maxWidth: 540, width: '100%', alignSelf: 'center' }, context: { flexDirection: 'row', gap: 10, paddingVertical: 18, borderBottomWidth: 1, borderColor: theme.border },
  copy: { flex: 1, minWidth: 0, gap: 4 }, nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 22 }, name: { flexShrink: 1, color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 },
  time: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5 }, body: { color: theme.text, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21 }, muted: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 20 },
  image: { width: '100%', aspectRatio: 1.5, borderRadius: 12, backgroundColor: theme.surfaceMuted, marginTop: 7 }, comment: { flexDirection: 'row', gap: 9, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border }, menu: { minWidth: 44, minHeight: 44, marginVertical: -11, marginLeft: 'auto', alignItems: 'center', justifyContent: 'center' },
  dock: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border, padding: 10, width: '100%', maxWidth: 540, alignSelf: 'center' }, prompt: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.surfaceMuted, padding: 8, paddingRight: 16, minHeight: 48, borderRadius: 24 },
  feedback: { paddingVertical: 16 }, error: { fontFamily: theme.font.body, color: theme.error, fontSize: 13, lineHeight: 20 }, retry: { minHeight: 44, justifyContent: 'center' }, link: { fontFamily: theme.font.medium, color: theme.accentText, fontSize: 13 }, empty: { alignItems: 'center', gap: 12, paddingVertical: 44 },
});
