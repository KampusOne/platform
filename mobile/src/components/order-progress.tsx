import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemeStyles, type Theme } from '@/src/lib/appearance';
import { orderDate, orderStatusLabel } from '@/src/lib/order-presentation';

type OrderEvent = { status: string; occurred_at: string };
export function OrderProgress({ status, pickup, timeline = [] }: { status: string; pickup: boolean; timeline?: OrderEvent[] }) {
  const { theme, styles } = useThemeStyles(createStyles);
  const complete = status === 'DELIVERED';
  const exceptional = ['CANCELLED', 'DISPUTED', 'REFUNDED', 'PAYMENT_FAILED'].includes(status);
  const [expanded, setExpanded] = useState(!complete && !exceptional);
  const color = complete ? theme.success : exceptional ? theme.error : theme.accentText;
  const detail = complete ? (pickup ? 'You have collected your items.' : 'Your items have been delivered.')
    : status === 'PENDING_PAYMENT' ? 'Your payment is awaiting confirmation.'
    : status === 'READY' ? (pickup ? 'Your items are ready to collect.' : 'Your items are ready for delivery.')
    : status === 'IN_DELIVERY' ? 'Your order is on its way to you.'
    : status === 'PAID' ? 'The store has received your order.'
    : status === 'ACCEPTED' ? 'The store is getting your items ready.' : '';
  return <View style={styles.content}>
    <View style={styles.statusRow}>
      <View style={[styles.statusIcon, { borderColor: color }]}><Ionicons name={complete ? 'checkmark' : exceptional ? 'alert-outline' : 'bag-handle-outline'} size={23} color={color} /></View>
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={styles.status}>{orderStatusLabel(status, pickup)}</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Hide order timeline' : 'View order timeline'} accessibilityState={{ expanded }}
      onPress={() => setExpanded(value => !value)} style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.55 }]}>
      <Text style={styles.toggleText}>{expanded ? 'Hide order timeline' : 'View order timeline'}</Text>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={theme.accentText} />
    </Pressable>
    {expanded ? <View accessibilityLabel="Order timeline" style={styles.timeline}>
      {timeline.length ? timeline.map((event, index) => {
        const last = index === timeline.length - 1;
        return <View key={`${event.occurred_at}:${index}`} style={styles.event}>
          <View style={styles.markerColumn}>
            {!last ? <View style={[styles.connector, { backgroundColor: theme.border }]} /> : null}
            <View style={[styles.dot, { backgroundColor: last ? color : theme.surfaceMuted, borderColor: last ? color : theme.border }]}>
              <Ionicons name={event.status === 'PENDING_PAYMENT' ? 'time-outline' : ['CANCELLED', 'DISPUTED', 'REFUNDED', 'PAYMENT_FAILED'].includes(event.status) ? 'remove' : 'checkmark'} size={10} color={last ? theme.verificationMark : theme.textMuted} />
            </View>
          </View>
          <View style={[styles.eventCopy, !last && { paddingBottom: 18 }]}>
            <Text style={[styles.eventTitle, last && { fontFamily: theme.font.semibold, color: theme.text }]}>{orderStatusLabel(event.status, pickup)}</Text>
            {orderDate(event.occurred_at) ? <Text style={styles.eventDate}>{orderDate(event.occurred_at)}</Text> : null}
          </View>
        </View>;
      }) : <Text style={styles.detail}>Updates will appear here as your order progresses.</Text>}
    </View> : null}
  </View>;
}
const createStyles = (theme: Theme) => StyleSheet.create({
  content: { gap: 8 },
  statusRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  statusIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 4 },
  status: { fontFamily: theme.font.display, fontSize: 20, lineHeight: 26, color: theme.text },
  detail: { fontFamily: theme.font.body, fontSize: 12, lineHeight: 18, color: theme.textMuted },
  toggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toggleText: { fontFamily: theme.font.medium, fontSize: 12, color: theme.accentText },
  timeline: { paddingTop: 4, paddingBottom: 8 },
  event: { flexDirection: 'row', gap: 12 },
  markerColumn: { width: 16, alignItems: 'center' },
  connector: { position: 'absolute', width: 1, top: 8, bottom: -8 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  eventCopy: { flex: 1, gap: 4 },
  eventTitle: { fontFamily: theme.font.body, fontSize: 12, lineHeight: 18, color: theme.textMuted },
  eventDate: { fontFamily: theme.font.body, fontSize: 11, lineHeight: 16, color: theme.textMuted },
});
