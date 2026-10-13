import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { useAppearance } from '@/src/lib/appearance';

export function RetryIconButton({
  label,
  onPress,
  disabled = false,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const { theme } = useAppearance();
  const unavailable = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: unavailable, busy }}
      disabled={unavailable}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.surfaceMuted,
        opacity: unavailable ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={busy ? 'hourglass-outline' : 'refresh-outline'} size={21} color={theme.deepBrand} />
    </Pressable>
  );
}
