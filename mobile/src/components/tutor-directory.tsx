import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { api } from '@/src/lib/api';
import { useAppearance } from '@/src/lib/appearance';
import { MediaImage } from './media-image';
import { Pagination } from './pagination';
import type { PageInfo } from '@/src/lib/pagination';
import { VerifiedBadge } from './verified-badge';
import { RetryIconButton } from './retry-icon-button';
import { SkeletonBlock } from './skeleton';

type Tutor = { id: string; display_name: string; biography: string | null; specialties: string[] | null; profile_image_url: string | null; verified?: boolean };
export function TutorDirectory({ query, expanded, onPageChange }: { query: string; expanded: boolean; onPageChange?: () => void }) {
  const { theme } = useAppearance();
  const [selection, setSelection] = useState({ query: '', page: 1 });
  const page = selection.query === query ? selection.page : 1;
  const [pagination, setPagination] = useState<PageInfo | null>(null);
  const [rows, setRows] = useState<Tutor[]>([]), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setRows([]);
    void api<{ tutors: Tutor[]; pagination?: PageInfo }>('/v1/student/tutors?page=' + (expanded ? page : 1) + (query ? '&q=' + encodeURIComponent(query) : ''), { signal: controller.signal })
      .then(r => { if (!controller.signal.aborted) { setRows(r.tutors); setPagination(r.pagination ?? null); if(r.pagination && page > r.pagination.totalPages) setSelection({query,page:r.pagination.totalPages}); } })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Tutors could not load.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, revision, expanded, page]);
  if (!rows.length && !expanded && !query && !loading && !error) return null;
  return <View style={{ gap: 14, marginTop: 22, marginBottom: 12 }}>
    <Text style={{ color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 21 }}>{query ? 'Matching tutors' : 'Meet your tutors'}</Text>
    {loading ? <View accessibilityLabel="Searching tutors" accessibilityState={{ busy: true }} style={{ gap: 10 }}><SkeletonBlock width="65%" /><SkeletonBlock height={105} /></View> : null}
    {error ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text accessibilityRole="alert" style={{ flex: 1, color: theme.error }}>{error}</Text><RetryIconButton label="Retry tutor search" busy={loading} onPress={() => setRevision(n => n + 1)} /></View> : null}
    {rows.length ? <ScrollView horizontal={!expanded} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
      {(expanded ? rows.slice(0,30) : rows.slice(0,6)).map(t => <Pressable key={t.id} accessibilityRole="button" accessibilityLabel={`View tutor ${t.display_name}`} onPress={() => router.push({ pathname: '/student-service', params: { id: t.id } })} style={{ width: expanded ? '100%' : 210, padding: 16, gap: 9, borderWidth: 1, borderColor: theme.border, borderRadius: 14, backgroundColor: theme.surface }}>
        {t.profile_image_url ? <MediaImage uri={t.profile_image_url} accessibilityLabel={t.display_name} style={{ width: 48, height: 48, borderRadius: 24 }} /> : <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.surfaceTint, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: theme.deepBrand, fontFamily: theme.font.semibold }}>{t.display_name.slice(0, 2).toUpperCase()}</Text></View>}
        <View style={{flexDirection:'row',alignItems:'center',gap:5}}><Text style={{ flexShrink:1, color: theme.text, fontFamily: theme.font.semibold, fontSize: 16 }}>{t.display_name}</Text>{t.verified===true?<VerifiedBadge label="Verified tutor" size={15}/>:null}</View>
        <Text numberOfLines={2} style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 }}>{t.specialties?.join(' · ') || t.biography || 'KampusOne tutor'}</Text>
      </Pressable>)}
    </ScrollView> : null}
    {expanded && pagination && !error ? <Pagination {...pagination} label="Tutors" disabled={loading} onChange={next=>{setSelection({query,page:next});onPageChange?.();}}/> : null}
    {!loading && !rows.length && !error ? <Text style={{ color: theme.textMuted }}>No tutors match your search.</Text> : null}
  </View>;
}
