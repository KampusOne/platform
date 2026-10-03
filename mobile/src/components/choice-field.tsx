import { useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppearance } from '@/src/lib/appearance';

export type Choice = { value: string; label: string };
export function ChoiceField({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: Choice[]; onChange: (value: string) => void; disabled?: boolean }) {
  const { theme } = useAppearance();
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const selected = options.find(item => item.value === value);
  return <View style={{ gap: 8, minWidth: 0, width: '100%' }}>
    <Text style={{ color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 12 }}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label ?? 'Choose'}`} accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => { setQuery(''); setOpen(true); }} style={{ minHeight: 48, borderWidth: 1, borderColor: theme.border, borderRadius: 12, backgroundColor: theme.surface, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontFamily: theme.font.body }}>{selected?.label ?? `Choose ${label.toLowerCase()}`}</Text><Ionicons name="chevron-down" size={16} color={theme.textMuted} />
    </Pressable>
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.canvas, padding: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18 }}><Text accessibilityRole="header" style={{ flex: 1, fontSize: 20, color: theme.text, fontFamily: theme.font.bold }}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close choices" onPress={() => setOpen(false)} style={{ padding: 12 }}><Ionicons name="close" size={24} color={theme.text} /></Pressable></View>
        {options.length > 12 && <TextInput accessibilityLabel={`Search ${label}`} placeholder="Search…" value={query} onChangeText={setQuery} style={{ minHeight: 48, padding: 12, color: theme.text, backgroundColor: theme.surface, borderRadius: 10, marginBottom: 12 }} />}
        <FlatList keyboardShouldPersistTaps="handled" data={options.filter(item => item.label.toLowerCase().includes(query.toLowerCase()))} keyExtractor={item => item.value} renderItem={({ item }) => <Pressable accessibilityRole="radio" accessibilityState={{ selected: value === item.value }} onPress={() => { onChange(item.value); setOpen(false); }} style={{ minHeight: 54, flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderColor: theme.border }}><Text style={{ flex: 1, fontFamily: theme.font.body, color: theme.text }}>{item.label}</Text>{value === item.value && <Ionicons name="checkmark" size={22} color={theme.brand} />}</Pressable>} ListEmptyComponent={<Text style={{ color: theme.textMuted }}>No matching choices</Text>} />
      </SafeAreaView>
    </Modal>
  </View>;
}
