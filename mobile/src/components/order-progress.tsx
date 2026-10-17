import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';
import { useAppearance } from '@/src/lib/appearance';
import { orderStages, orderStatusLabel } from '@/src/lib/order-presentation';

export function OrderProgress({ status, pickup }: { status: string; pickup: boolean }) {
  const { theme } = useAppearance();
  const exceptional = ['CANCELLED', 'DISPUTED', 'REFUNDED', 'PAYMENT_FAILED'].includes(status);
  const stages = orderStages(status, pickup);
  const current = stages.findLastIndex(stage => stage.complete);
  return <View style={{ gap: 20 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Ionicons name={status === 'DELIVERED' ? 'checkmark-circle' : exceptional ? 'alert-circle-outline' : 'time-outline'} size={20} color={status === 'DELIVERED' ? theme.success : theme.accentText} />
      <Text accessibilityRole="header" style={{ flex: 1, fontFamily: theme.font.semibold, fontSize: 16, color: theme.text }}>{orderStatusLabel(status, pickup)}</Text>
    </View>
    {!exceptional ? <View accessibilityLabel={`Order progress: ${orderStatusLabel(status, pickup)}`} style={{ flexDirection: 'row' }}>
      {stages.map((stage, index) => <View key={stage.label} style={{ flex: 1, alignItems: 'center', gap: 10 }}>
        {index < stages.length - 1 ? <View style={{ position: 'absolute', height: 2, top: 18, left: '50%', width: '100%', backgroundColor: stages[index + 1]!.complete ? theme.success : theme.border }} /> : null}
        <View style={{ height: 38, width: 38, borderRadius: 12, backgroundColor: stage.complete ? theme.surfaceTint : theme.surfaceMuted, borderWidth: index === current ? 1.5 : 0, borderColor: status === 'DELIVERED' ? theme.success : theme.accentText, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={stage.complete ? 'checkmark' : stage.icon} size={18} color={stage.complete ? theme.success : theme.textFaint} />
        </View>
        <Text style={{ fontFamily: stage.complete ? theme.font.semibold : theme.font.body, fontSize: 10.5, color: stage.complete ? theme.text : theme.textMuted, textAlign: 'center', paddingHorizontal: 2 }}>{stage.label}</Text>
      </View>)}
    </View> : null}
  </View>;
}
