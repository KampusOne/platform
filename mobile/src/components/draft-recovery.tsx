import { Text, View } from 'react-native';
import { ToolButton } from './toolkit';
import { useAppearance } from '../lib/appearance';
export function DraftRecovery({ error, loading, onRetry }: { error: string; loading: boolean; onRetry(): void }) {
  const { theme } = useAppearance();
  if (!error && !loading) return null;
  return <View style={{ padding: 16, marginBottom: 16, gap: 10, backgroundColor: theme.surfaceMuted, borderRadius: 12 }}>
    <Text accessibilityRole={error ? 'alert' : 'text'} accessibilityLiveRegion="polite" style={{ fontFamily: theme.font.body, color: error ? theme.error : theme.textMuted, lineHeight: 21 }}>
      {error || 'Restoring your saved draft…'}
    </Text>
    {error ? <ToolButton secondary label="Retry restoring draft" onPress={onRetry} /> : null}
  </View>;
}
