import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppearance } from '@/src/lib/appearance';
import { pageSlots, type PageInfo } from '@/src/lib/pagination';

export function Pagination({ page, pageSize, total, totalPages, onChange, disabled = false, label = 'Results' }: PageInfo & {
  onChange: (page: number) => void; disabled?: boolean; label?: string;
}) {
  const { theme } = useAppearance();
  if (totalPages <= 1) return null;
  const go = (next: number) => { if (!disabled && next >= 1 && next <= totalPages && next !== page) onChange(next); };
  const button = { minWidth: 44, minHeight: 44, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const };
  return <View accessibilityLabel={`${label} pagination`} style={{ paddingTop: 24, paddingBottom: 12, gap: 14, alignItems: 'center', borderTopWidth: 1, borderTopColor: theme.border, marginTop: 22 }}>
    <Text accessibilityLiveRegion="polite" style={{ fontFamily: theme.font.body, color: theme.textMuted, fontSize: 12 }}>
      {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total} · Page {page} of {totalPages}
    </Text>
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 0, flexWrap: 'wrap' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Previous ${label.toLowerCase()} page`} accessibilityState={{ disabled: disabled || page <= 1 }} disabled={disabled || page <= 1} onPress={() => go(page - 1)} style={({ pressed }) => [button, { opacity: disabled || page <= 1 ? 0.3 : pressed ? 0.6 : 1 }]}>
        <Ionicons name="chevron-back" size={20} color={theme.deepBrand} />
      </Pressable>
      {pageSlots(page, totalPages).map((slot, i) => slot === 'gap' ? <View key={`gap-${i}`} style={{ ...button, minWidth: 14 }}><Text style={{ color: theme.textMuted }}>…</Text></View> :
        <Pressable key={slot} accessibilityRole="button" accessibilityLabel={`${label} page ${slot}`} accessibilityState={{ selected: slot === page, disabled }} disabled={disabled} onPress={() => go(slot)} style={({ pressed }) => [button, { borderWidth: 1, borderColor: slot === page ? theme.deepBrand : theme.border, backgroundColor: slot === page ? theme.deepBrand : theme.surface, opacity: disabled ? 0.45 : pressed ? 0.65 : 1 }]}>
          <Text style={{ color: slot === page ? '#fff' : theme.text, fontFamily: slot === page ? theme.font.semibold : theme.font.medium, fontSize: 14 }}>{slot}</Text>
        </Pressable>)}
      <Pressable accessibilityRole="button" accessibilityLabel={`Next ${label.toLowerCase()} page`} accessibilityState={{ disabled: disabled || page >= totalPages }} disabled={disabled || page >= totalPages} onPress={() => go(page + 1)} style={({ pressed }) => [button, { opacity: disabled || page >= totalPages ? 0.3 : pressed ? 0.6 : 1 }]}>
        <Ionicons name="chevron-forward" size={20} color={theme.deepBrand} />
      </Pressable>
    </View>
  </View>;
}
