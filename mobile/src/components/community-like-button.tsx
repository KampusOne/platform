import { useCallback, useMemo, useSyncExternalStore, useEffect } from 'react';
import { Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/src/auth/auth-context';
import { useAppearance } from '@/src/lib/appearance';
import { api } from '@/src/lib/api';
import { cacheScopeForUser } from '@/src/lib/request-policy';
import { PostLikeStore, initialLikeState, type PostLike } from '@/src/lib/post-like-store';
const stores = new Map<string, PostLikeStore>();
let activeAccountScope = '';
export function CommunityLikeButton({ groupId, postId, liked, count, onError }: {
    groupId: string;
    postId: string;
    liked: boolean;
    count: number;
    onError: (message: string) => void;
}) {
    const { user } = useAuth(), { theme } = useAppearance();
    const accountScope = user ? cacheScopeForUser(user) : 'signed-out', scope = accountScope + ':' + groupId;
    if (activeAccountScope !== accountScope) {
        stores.forEach(store => store.dispose());
        stores.clear();
        activeAccountScope = accountScope;
    }
    const store = useMemo(() => { let value = stores.get(scope); if (!value) {
        const base = '/v1/communities/groups/' + encodeURIComponent(groupId);
        value = new PostLikeStore({ read: ids => api<{
                likes: PostLike[];
            }>(base + '/likes?ids=' + encodeURIComponent(ids.join(',')), { cache: 'reload' }), write: (id, desired) => api<PostLike>(base + '/posts/' + encodeURIComponent(id) + '/like', { method: desired ? 'PUT' : 'DELETE', body: '{}' }) });
        stores.set(scope, value);
        while (stores.size > 12) {
            const oldest = stores.keys().next().value;
            if (oldest === scope || oldest === undefined)
                break;
            stores.get(oldest)?.dispose();
            stores.delete(oldest);
        }
    } return value; }, [scope, groupId]);
    const subscribe = useCallback((listener: () => void) => store.subscribe(postId, listener), [store, postId]);
    const snapshot = useCallback(() => store.get(postId), [store, postId]);
    const saved = useSyncExternalStore(subscribe, snapshot, () => initialLikeState), state = saved === initialLikeState ? { ...saved, liked, count, ready: true, loading: false } : saved;
    useEffect(() => store.seed({ id: postId, liked, like_count: count }), [store, postId, liked, count]);
    useFocusEffect(useCallback(() => { store.loadIfMissing(postId); }, [store, postId]));
    return <Pressable accessibilityRole="button" accessibilityLabel={state.liked ? 'Unlike update' : 'Like update'} accessibilityState={{ selected: state.liked, busy: state.pending }} disabled={!user || state.pending || !state.ready} onPress={() => { store.seed({ id: postId, liked, like_count: count }); void store.toggle(postId).catch(error => onError(error.message)); }} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }}><Ionicons name={state.liked ? 'heart' : 'heart-outline'} size={20} color={state.liked ? theme.deepBrand : theme.textMuted}/><Text style={{ fontFamily: theme.font.semibold, fontSize: 12, color: state.liked ? theme.deepBrand : theme.textMuted }}>{state.count || 'Like'}</Text></Pressable>;
}
