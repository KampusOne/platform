import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/auth/auth-context';
import { useAppearance } from '@/src/lib/appearance';
import { api } from '@/src/lib/api';
import { ToolButton, ToolField } from './toolkit';
import { ScreenSkeleton } from './skeleton';

type Community = { name: string; guidelines: string; guidelines_version: number; request_status: string | null };
type JoinRequest = { id: string; full_name: string; matriculation_number: string; department: string; level: string; nickname: string; username: string; created_at: string };

export function CommunitySubscriptionSheet({ visible, base, group, onClose, onSaved }: { visible: boolean; base: string; group: Community; onClose: () => void; onSaved: () => Promise<void> }) {
  const { theme } = useAppearance(), { profile } = useAuth();
  const [name, setName] = useState(''), [matric, setMatric] = useState(''), [department, setDepartment] = useState(''), [level, setLevel] = useState(''), [nickname, setNickname] = useState('');
  const [accepted, setAccepted] = useState(false), [pending, setPending] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!visible) return;
    setPending(group.request_status === 'PENDING'); setError(''); setAccepted(false);
    setName([profile?.first_name, profile?.last_name].filter(Boolean).join(' '));
    setLevel(profile?.level_code ?? '');setDepartment(profile?.department_name??'');
    setNickname(profile?.display_name ?? '');
  }, [visible, group.request_status, profile]);
  const text = { fontFamily: theme.font.body, color: theme.text, fontSize: 15, lineHeight: 23 };
  async function submit() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api(base + '/join', { method: 'POST', body: JSON.stringify({ fullName: name, matriculationNumber: matric, department, level, nickname, guidelinesVersion: group.guidelines_version, guidelinesAccepted: accepted }) });
      setPending(true); await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Your request could not be sent. Your details are kept.'); }
    finally { setBusy(false); }
  }
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.canvas }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 18, flexGrow: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ ...text, flex: 1, fontFamily: theme.font.displayStrong, fontSize: 25 }}>{pending ? 'Request sent' : 'Subscribe to community'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close subscription form" onPress={onClose} disabled={busy} style={{ padding: 12 }}><Ionicons name="close" size={24} color={theme.text} /></Pressable></View>
          {pending ? <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 18, paddingBottom: 50 }}>
            <Image source={require('../../assets/illustrations/community-pending.png')} resizeMode="contain" style={{ width: 250, height: 220 }} />
            <Text style={{ ...text, fontFamily: theme.font.displayStrong, fontSize: 25 }}>You’re on the list</Text>
            <Text style={{ ...text, textAlign: 'center', color: theme.textMuted }}>Your request is pending. An admin will review it shortly.</Text>
            <ToolButton label="Back to community" onPress={onClose} />
          </View> : <>
            <View style={{ padding: 18, backgroundColor: theme.surfaceTint, borderRadius: 18, gap: 8 }}><Text style={{ ...text, fontFamily: theme.font.semibold }}>{group.name}</Text><Text style={{ ...text, color: theme.textMuted }}>Admins use these details to check your eligibility. Your matric number is visible only to you and the community admins.</Text></View>
            {error ? <Text accessibilityRole="alert" style={{ ...text, color: theme.error }}>{error}</Text> : null}
            <ToolField label="Full name" value={name} onChangeText={setName} maxLength={120} />
            <ToolField label="Matric number" value={matric} onChangeText={setMatric} maxLength={60} autoCapitalize="characters" />
            <ToolField label="Department" value={department} onChangeText={setDepartment} maxLength={180} />
            <View style={{ flexDirection: 'row', gap: 12 }}><View style={{ flex: 1 }}><ToolField label="Level" value={level} onChangeText={setLevel} maxLength={30} keyboardType="number-pad" /></View><View style={{ flex: 2 }}><ToolField label="Nickname" value={nickname} onChangeText={setNickname} maxLength={60} /></View></View>
            <Text style={{ ...text, fontSize: 12, color: theme.textMuted }}>Your nickname appears on your posts in this community.</Text>
            <View style={{ padding: 18, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 18, gap: 10 }}><Text style={{ ...text, fontFamily: theme.font.semibold }}>Community guidelines</Text><Text style={text}>{group.guidelines || 'Be respectful, keep posts relevant, and protect other members’ privacy.'}</Text></View>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} onPress={() => setAccepted(v => !v)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }}><Ionicons name={accepted ? 'checkbox' : 'square-outline'} size={25} color={theme.deepBrand} /><Text style={{ ...text, flex: 1 }}>I agree to follow these guidelines.</Text></Pressable>
            <ToolButton label={busy ? 'Sending request…' : 'Request to subscribe'} disabled={busy || !accepted || name.trim().length < 2 || matric.trim().length < 2 || department.trim().length < 2 || !level.trim() || !nickname.trim()} onPress={() => void submit()} />
          </>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

export function CommunityRequestInbox({ visible, base, onClose, onSaved }: { visible: boolean; base: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { theme } = useAppearance();
  const [requests, setRequests] = useState<JoinRequest[]>([]), [selected, setSelected] = useState<string[]>([]), [detail, setDetail] = useState<JoinRequest | null>(null), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const text = { fontFamily: theme.font.body, color: theme.text, fontSize: 15, lineHeight: 23 };
  async function load() { setLoading(true); try { const r = await api<{ requests: JoinRequest[] }>(base + '/requests'); setRequests(r.requests); setSelected([]); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load requests.'); } finally { setLoading(false); } }
  useEffect(() => { if (visible) { setDetail(null); setError(''); void load(); } }, [visible, base]);
  async function review(decision: 'APPROVED' | 'DECLINED', ids: string[] = selected, all = false) {
    if (busy) return; setBusy(true); setError('');
    try { await api(base + '/requests/review', { method: 'POST', body: JSON.stringify({ ids, all, decision }) }); setDetail(null); await Promise.all([load(), onSaved()]); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not review requests.'); } finally { setBusy(false); }
  }
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><SafeAreaView style={{ flex: 1, backgroundColor: theme.canvas }}><ScrollView contentContainerStyle={{ padding: 24, gap: 18 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ ...text, fontFamily: theme.font.displayStrong, fontSize: 25, flex: 1 }}>Subscription requests</Text><Pressable accessibilityRole="button" accessibilityLabel="Close requests" onPress={onClose} style={{ padding: 10 }}><Ionicons name="close" size={25} color={theme.text} /></Pressable></View>
    {error ? <Text accessibilityRole="alert" style={{ ...text, color: theme.error }}>{error}</Text> : null}
    {detail ? <>
      <ToolButton secondary label="Back to requests" onPress={() => setDetail(null)} />
      <View style={{ padding: 22, borderRadius: 20, backgroundColor: theme.surface, gap: 16 }}>
        {([['Full name', detail.full_name], ['Matric number', detail.matriculation_number], ['Department', detail.department], ['Level', detail.level], ['Nickname', detail.nickname]] as const).map(([label, value]) => <View key={label} style={{ gap: 3 }}><Text style={{ ...text, fontSize: 12, color: theme.textMuted }}>{label}</Text><Text style={{ ...text, fontFamily: theme.font.semibold }}>{value}</Text></View>)}
        <Text style={{ ...text, color: theme.deepBrand }}>Guidelines accepted</Text>
      </View>
      <ToolButton label={busy ? 'Saving…' : 'Approve subscription'} disabled={busy} onPress={() => void review('APPROVED', [detail.id])} />
      <ToolButton secondary label="Decline request" disabled={busy} onPress={() => void review('DECLINED', [detail.id])} />
    </> : loading ? <ScreenSkeleton /> : <>
      <Text style={{ ...text, color: theme.textMuted }}>{requests.length ? 'Review each request or choose several to approve together.' : 'You’re all caught up. New subscription requests will appear here.'}</Text>
      {requests.length ? <ToolButton secondary label="Approve all pending requests" disabled={busy} onPress={() => void review('APPROVED', [], true)} /> : null}
      {selected.length ? <ToolButton label={`Approve ${selected.length} selected`} disabled={busy} onPress={() => void review('APPROVED')} /> : null}
      {requests.map(request => <View key={request.id} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', borderRadius: 16, padding: 14, backgroundColor: theme.surface, borderWidth: 1, borderColor: selected.includes(request.id) ? theme.deepBrand : theme.border }}>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={`Select ${request.full_name}`} accessibilityState={{ checked: selected.includes(request.id) }} onPress={() => setSelected(v => v.includes(request.id) ? v.filter(id => id !== request.id) : [...v, request.id])} style={{ padding: 8 }}><Ionicons name={selected.includes(request.id) ? 'checkbox' : 'square-outline'} size={24} color={theme.deepBrand} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Review ${request.full_name}`} onPress={() => setDetail(request)} style={{ flex: 1, gap: 4 }}><Text style={{ ...text, fontFamily: theme.font.semibold }}>{request.full_name}</Text><Text style={{ ...text, fontSize: 12, color: theme.textMuted }}>{request.department} · {request.level} level</Text></Pressable><Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
      </View>)}
    </>}
  </ScrollView></SafeAreaView></Modal>;
}
