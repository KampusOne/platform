import { useCallback, useRef, useState } from 'react';
import { Text, View, Pressable, AppState } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ToolPage, ToolRow, ToolButton } from '@/src/components/toolkit';
import { api } from '@/src/lib/api';
import { useAppearance } from '@/src/lib/appearance';
import { useAuth } from '@/src/auth/auth-context';
type Thread = { id: string; display_name: string; last_message: string; unread_count: number };
type Inbox = { threads: Thread[]; nextCursor: string | null };
const filters = ['All', 'Unread', 'Requests', 'Tutor', 'Vendor', 'Rider'] as const;
export default function MessagesScreen() {
  const { theme } = useAppearance(), { user } = useAuth();
  const [threads, setThreads] = useState<Thread[]>([]), [filter, setFilter] = useState<typeof filters[number]>('All');
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [moreBusy, setMoreBusy] = useState(false), [refreshing, setRefreshing] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const epoch = useRef(0), loadingRef = useRef(false), paged = useRef(false);
  const load = useCallback(async (before?: string) => {
    if (loadingRef.current) return;
    const version = epoch.current;
    loadingRef.current = true;
    if (before) setMoreBusy(true);
    try {
      const r = await api<Inbox>(`/v1/messages/inbox?filter=${filter}${before ? `&before=${encodeURIComponent(before)}` : ''}`);
      if (version !== epoch.current) return;
      setThreads(current => before ? [...current, ...r.threads.filter(t => !current.some(old => old.id === t.id))] : r.threads);
      setCursor(r.nextCursor); setError(''); paged.current = Boolean(before);
    } catch (e) {
      if (version === epoch.current) setError(e instanceof Error ? e.message : 'Messages could not load.');
    } finally {
      if (version === epoch.current) { loadingRef.current = false; setLoading(false); setMoreBusy(false); }
    }
  }, [filter, user?.id]);
  const refresh = useCallback(async () => {
    if (loadingRef.current) return;
    paged.current = false;
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);
  useFocusEffect(useCallback(() => {
    epoch.current += 1; loadingRef.current = false; paged.current = false;
    setThreads([]); setCursor(null); setLoading(true); setRefreshing(false); setError('');
    void load();
    const timer = setInterval(() => { if (AppState.currentState === 'active' && !paged.current) void load(); }, 15000);
    return () => { epoch.current += 1; loadingRef.current = false; clearInterval(timer); };
  }, [load]));
  return <ToolPage title="Messages" refreshing={refreshing} onRefresh={() => { void refresh(); }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {filters.map(f => <Pressable key={f} accessibilityRole="button" accessibilityState={{ selected: filter === f }} onPress={() => setFilter(f)} style={{ minHeight: 44, padding: 12, borderRadius: 10, backgroundColor: filter === f ? theme.deepBrand : theme.surface }}>
        <Text style={{ color: filter === f ? 'white' : theme.text }}>{f}</Text>
      </Pressable>)}
    </View>
    {error ? <Text accessibilityRole="alert" style={{ color: theme.error }}>{error}</Text> : null}
    {loading ? <Text style={{ color: theme.textMuted }}>Loading…</Text> : !error && !threads.length ? <Text style={{ color: theme.textMuted }}>No {filter === 'Requests' ? 'requests' : 'conversations'} yet.</Text> : threads.map(t => <ToolRow key={t.id} title={t.display_name} detail={t.last_message || 'Start a conversation'} onPress={() => router.push({ pathname: '/conversation', params: { id: t.id } })} trailing={t.unread_count > 0 ? <Text accessibilityLabel={`${t.unread_count} unread messages`} style={{ color: theme.brand, fontWeight: '700' }}>{t.unread_count > 99 ? '99+' : t.unread_count}</Text> : undefined} />)}
    {cursor ? <ToolButton label={moreBusy ? 'Loading…' : 'Load older conversations'} disabled={moreBusy} onPress={() => void load(cursor)} /> : null}
  </ToolPage>;
}
