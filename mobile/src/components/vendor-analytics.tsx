import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Text, View } from 'react-native';
import { api } from '@/src/lib/api';
import { useAppearance } from '@/src/lib/appearance';
import { SkeletonBlock } from './skeleton';
import { RetryIconButton } from './retry-icon-button';

type Day = { day: string; orders: number; delivered: number; net_kobo: number | string };
const currency = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });
export function VendorAnalytics() {
  const { theme } = useAppearance();
  const [days, setDays] = useState<Day[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError('');
    try {
      const result = await api<{ trend: Day[] }>('/v1/agents/analytics', { cache: 'reload', signal: controller.signal });
      if (!controller.signal.aborted) setDays(result.trend);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Sales could not load.');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { request.current?.abort(); };
  }, [load]));
  const max = Math.max(1, ...(days ?? []).map(d => Number(d.net_kobo)));
  const total = (days ?? []).reduce((n, d) => n + Number(d.net_kobo), 0);
  const orders = (days ?? []).reduce((n, d) => n + Number(d.orders), 0);
  const delivered = (days ?? []).reduce((n, d) => n + Number(d.delivered), 0);
  return <View style={{ padding: 18, borderWidth: 1, borderColor: theme.border, borderRadius: 16, backgroundColor: theme.surface, gap: 12, marginBottom: 20 }}>
    <Text style={{ color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 20 }}>Your sales · last 14 days</Text>
    {days === null && loading ? <View accessibilityLabel="Loading sales" accessibilityState={{ busy: true }} style={{ gap: 12 }}>
      <SkeletonBlock width="48%" height={28} /><SkeletonBlock width="70%" /><SkeletonBlock height={105} />
    </View> : null}
    {days !== null ? <>
      <Text style={{ color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 24 }}>{currency.format(total / 100)}</Text>
      <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 }}>{orders} paid orders · {delivered} delivered</Text>
      <View accessibilityLabel={days.map(d => `${d.day}: ${d.orders} orders, ${currency.format(Number(d.net_kobo) / 100)}`).join('. ')} style={{ height: 105, flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
        {days.map(d => <View key={d.day} style={{ flex: 1, height: Math.max(3, 95 * Number(d.net_kobo) / max), borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: Number(d.net_kobo) > 0 ? theme.deepBrand : theme.border }} />)}
      </View>
      {!orders ? <Text style={{ color: theme.textMuted, fontFamily: theme.font.body }}>No paid sales in this period yet.</Text> : null}
      {loading ? <Text accessibilityLiveRegion="polite" style={{ color: theme.textMuted }}>Updating sales…</Text> : null}
    </> : null}
    {error ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text accessibilityRole="alert" style={{ flex: 1, color: theme.error }}>{days !== null ? 'Showing the last loaded sales. ' : ''}{error}</Text>
      <RetryIconButton label="Retry sales" busy={loading} onPress={() => void load()} />
    </View> : null}
    <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11 }}>Vendor share of paid sales. Undelivered orders remain pending in Earnings.</Text>
  </View>;
}
