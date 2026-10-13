import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, Text, View } from 'react-native';
import { ToolPage, ToolField, ToolButton } from '@/src/components/toolkit';
import { RetryIconButton } from '@/src/components/retry-icon-button';
import { useAppearance } from '@/src/lib/appearance';
import { useAuth } from '@/src/auth/auth-context';
import { api, ApiError } from '@/src/lib/api';

type Bank = { code: string; name: string };
type Account = { id: string; status: string; bank_name: string; account_name: string; account_last4: string };
type Profile = { id: string; display_name: string; agent_type: string; bank_edit_locked?: boolean; account: Account | null };
function statusLabel(status: string) {
  return status === 'APPROVED' ? 'Verified' : status === 'REJECTED' ? 'Needs attention' : 'Pending approval';
}
export default function BankAccount() {
  const { user } = useAuth();
  return <OwnedBankAccount key={user?.id ?? 'anonymous'} />;
}
function OwnedBankAccount() {
  const { theme } = useAppearance(), params = useLocalSearchParams<{ profileId?: string }>();
  const [profiles, setProfiles] = useState<Profile[]>([]), [profileId, setProfileId] = useState(params.profileId ?? '');
  const [banks, setBanks] = useState<Bank[]>([]), [bankCode, setBankCode] = useState(''), [query, setQuery] = useState(''), [choosing, setChoosing] = useState(false);
  const [accountNumber, setAccountNumber] = useState(''), [accountName, setAccountName] = useState(''), [authorized, setAuthorized] = useState(false);
  const [ready, setReady] = useState(false), [available, setAvailable] = useState(false), [busy, setBusy] = useState(false), [looking, setLooking] = useState(false);
  const [editing, setEditing] = useState(false), [confirmDelete, setConfirmDelete] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [lookupAttempt, setLookupAttempt] = useState(0);
  const saving = useRef(false), request = useRef(''), alive = useRef(true), lookupVersion = useRef(0), loadVersion = useRef(0), banksLoaded = useRef(false);
  const profile = profiles.find(p => p.id === profileId), account = profile?.account, bank = banks.find(b => b.code === bankCode);
  const showForm = Boolean(profile && (!account || editing)), locked = Boolean(profile?.bank_edit_locked);
  const text = { color: theme.text, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21 };
  const muted = { ...text, color: theme.textMuted, fontSize: 13 };

  useEffect(() => { alive.current = true; return () => { alive.current = false; lookupVersion.current++; loadVersion.current++; }; }, []);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    const setup = await api<{ profiles: Profile[]; providerAvailable: boolean }>('/v1/payout-setup', { cache: 'reload' });
    if (!alive.current || version !== loadVersion.current) return;
    setProfiles(setup.profiles); setReady(true); setAvailable(setup.providerAvailable);
    setProfileId(current => setup.profiles.some(p => p.id === current) ? current : setup.profiles[0]?.id ?? '');
    if (setup.providerAvailable && !banksLoaded.current) {
      const list = await api<{ banks: Bank[] }>('/v1/payout-setup/banks');
      if (alive.current && version === loadVersion.current) { setBanks(list.banks); banksLoaded.current = true; }
    }
  }, []);
  useFocusEffect(useCallback(() => {
    void load().catch(e => { if (alive.current) { setReady(true); setError(e instanceof Error ? e.message : 'Bank details could not load.'); } });
    return () => { loadVersion.current++; };
  }, [load]));
  useEffect(() => {
    const version = ++lookupVersion.current;
    setAccountName(''); setLooking(false); request.current = '';
    if (!showForm || locked || !profileId || !bankCode || !/^[0-9]{10}$/.test(accountNumber) || !authorized) return;
    const controller = new AbortController(), timer = setTimeout(() => {
      setLooking(true); setError('');
      void api<{ accountName: string }>('/v1/payout-setup/account-name', { method: 'POST', signal: controller.signal, timeoutMs: 15000, body: JSON.stringify({ agentProfileId: profileId, bankCode, accountNumber, authorizedAccount: true }) })
        .then(r => { if (alive.current && version === lookupVersion.current) setAccountName(r.accountName); })
        .catch(e => { if (alive.current && version === lookupVersion.current && !controller.signal.aborted) setError(e instanceof Error ? e.message : 'Account name could not be checked.'); })
        .finally(() => { if (alive.current && version === lookupVersion.current) setLooking(false); });
    }, 600);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [profileId, bankCode, accountNumber, authorized, lookupAttempt, showForm, locked]);

  function resetForm() {
    lookupVersion.current++; request.current = ''; setBankCode(''); setAccountNumber(''); setAccountName(''); setAuthorized(false); setChoosing(false); setQuery(''); setError('');
  }
  async function save() {
    if (saving.current || !profileId || !accountName || !authorized || locked) return;
    saving.current = true; loadVersion.current++; setBusy(true); setError(''); setNotice('');
    try {
      request.current ||= Crypto.randomUUID();
      const result = await api<{ account: Account }>('/v1/payout-setup/resolve', { method: 'POST', timeoutMs: 30000, body: JSON.stringify({ agentProfileId: profileId, bankCode, accountNumber, requestId: request.current, authorizedAccount: true }) });
      if (!alive.current) return;
      setProfiles(old => old.map(p => p.id === profileId ? { ...p, account: result.account } : p));
      resetForm(); setEditing(false); setNotice('Bank account saved.');
    } catch (e) {
      if (e instanceof ApiError && e.details?.restartRequired === true) request.current = '';
      if (alive.current) setError(e instanceof Error ? e.message : 'Bank details could not be saved.');
    } finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  async function remove() {
    if (saving.current || !account?.id || locked) return;
    saving.current = true; loadVersion.current++; setBusy(true); setError(''); setNotice('');
    try {
      await api('/v1/payout-setup/' + account.id, { method: 'DELETE', timeoutMs: 15000 });
      if (!alive.current) return;
      setProfiles(old => old.map(p => p.id === profileId ? { ...p, account: null } : p));
      resetForm(); setEditing(false); setConfirmDelete(false); setNotice('Bank account deleted.');
    } catch (e) {
      if (alive.current) { setConfirmDelete(false); setError(e instanceof Error ? e.message : 'Bank account could not be deleted.'); }
    } finally { saving.current = false; if (alive.current) setBusy(false); }
  }

  return <ToolPage title="Bank account">
    {error ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18 }}><Text accessibilityRole="alert" style={{ ...text, color: theme.error, flex: 1 }}>{error}</Text><RetryIconButton label="Retry bank details" disabled={busy || looking} onPress={() => { setError(''); setLookupAttempt(v => v + 1); void load().catch(e => setError(e instanceof Error ? e.message : 'Bank details could not load.')); }} /></View> : null}
    {!ready ? <Text style={muted}>Loading bank details…</Text> : !profiles.length ? <Text style={text}>An approved agent profile is required.</Text> : <>
      {profiles.length > 1 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginBottom: 18 }}>{profiles.map(p => <Pressable key={p.id} accessibilityRole="button" accessibilityState={{ selected: p.id === profileId }} disabled={busy} onPress={() => { resetForm(); setEditing(false); setNotice(''); setProfileId(p.id); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ ...text, color: p.id === profileId ? theme.brand : theme.textMuted, fontFamily: theme.font.semibold }}>{p.display_name}</Text></Pressable>)}</View> : null}
      {account && !editing ? <>
        <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 18, padding: 20, backgroundColor: theme.surface, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Ionicons name="business-outline" size={25} color={theme.brand} /><Text style={{ ...text, fontFamily: theme.font.semibold, fontSize: 16, flex: 1 }}>{account.bank_name}</Text></View>
          <Text style={{ ...text, fontFamily: theme.font.semibold }}>{account.account_name}</Text>
          <Text accessibilityLabel={'Account ending in ' + account.account_last4} style={muted}>•••• {account.account_last4}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderColor: theme.border, paddingTop: 12 }}><Ionicons name={account.status === 'APPROVED' ? 'checkmark-circle-outline' : 'time-outline'} size={17} color={theme.textMuted} /><Text style={muted}>{statusLabel(account.status)}</Text></View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 14, marginTop: 14 }}>
          <Pressable accessibilityRole="button" disabled={busy || locked || !available} onPress={() => { resetForm(); setNotice(''); setEditing(true); }} style={{ minHeight: 48, flexDirection: 'row', gap: 8, alignItems: 'center', opacity: busy || locked || !available ? 0.45 : 1 }}><Ionicons name="pencil-outline" color={theme.brand} size={18} /><Text style={{ ...text, color: theme.brand, fontFamily: theme.font.semibold }}>Edit account</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Delete bank account" disabled={busy || locked} onPress={() => setConfirmDelete(true)} style={{ minHeight: 48, flexDirection: 'row', gap: 8, alignItems: 'center', opacity: busy || locked ? 0.45 : 1 }}><Ionicons name="trash-outline" color={theme.error} size={18} /><Text style={{ ...text, color: theme.error }}>Delete account</Text></Pressable>
        </View>
      </> : null}
      {locked ? <Text style={{ ...muted, marginTop: 12 }}>Bank details cannot change while a withdrawal or verification is in progress.</Text> : null}
      {showForm ? <View style={{ gap: 14 }}>
        <Text style={muted}>{editing ? 'Enter the new bank details below.' : 'Add the account you want to receive your earnings in.'}</Text>
        {!available ? <Text style={{ ...text, color: theme.error }}>Bank verification is temporarily unavailable. Please try again later.</Text> : <>
          <View><Text style={{ ...text, marginBottom: 8 }}>Bank</Text><Pressable accessibilityRole="button" accessibilityLabel="Choose bank" disabled={busy || locked || !banks.length} onPress={() => setChoosing(v => !v)} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 14, backgroundColor: theme.surface, padding: 16, minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10 }}><Text style={{ ...text, flex: 1, color: bank ? theme.text : theme.textMuted }}>{bank?.name ?? (banks.length ? 'Choose your bank' : 'Loading banks…')}</Text><Ionicons name="chevron-down" size={18} color={theme.textMuted} /></Pressable></View>
          {choosing ? <View><ToolField label="Search banks" value={query} onChangeText={setQuery} />{banks.filter(b => b.name.toLowerCase().includes(query.toLowerCase())).slice(0, 12).map(b => <Pressable key={b.code} accessibilityRole="button" disabled={busy} onPress={() => { lookupVersion.current++; setAccountName(''); setAuthorized(false); setBankCode(b.code); setChoosing(false); setQuery(''); }} style={{ paddingVertical: 14, borderBottomWidth: 1, borderColor: theme.border }}><Text style={text}>{b.name}</Text></Pressable>)}{!banks.some(b => b.name.toLowerCase().includes(query.toLowerCase())) ? <Text style={muted}>No banks match that name.</Text> : null}</View> : null}
          <ToolField label="Account number" placeholder="10-digit account number" keyboardType="number-pad" autoComplete="off" maxLength={10} value={accountNumber} editable={!busy && !locked} onChangeText={v => { lookupVersion.current++; setAccountName(''); setAuthorized(false); setAccountNumber(v.replace(/\D/g, '')); }} />
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: authorized, disabled: busy || locked }} disabled={busy || locked} onPress={() => setAuthorized(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}><Ionicons name={authorized ? 'checkbox' : 'square-outline'} size={23} color={theme.brand} /><Text style={{ ...text, flex: 1 }}>This is my bank account.</Text></Pressable>
          {looking ? <Text style={muted}>Checking account name…</Text> : accountName ? <View style={{ padding: 14, borderRadius: 12, backgroundColor: theme.surfaceTint, gap: 4 }}><Text style={muted}>Account name</Text><Text style={{ ...text, fontFamily: theme.font.semibold }}>{accountName}</Text></View> : null}
          <ToolButton label={busy ? 'Saving…' : 'Save account'} disabled={busy || !accountName || looking || !authorized || locked} onPress={() => void save()} />
        </>}
        {editing ? <ToolButton secondary label="Cancel" disabled={busy} onPress={() => { resetForm(); setEditing(false); }} /> : null}
      </View> : null}
      {notice ? <Text accessibilityRole="alert" style={{ ...text, marginTop: 18 }}>{notice}</Text> : null}
    </>}
    <Modal transparent visible={confirmDelete} animationType="fade" onRequestClose={() => { if (!busy) setConfirmDelete(false); }}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 }}><View accessibilityViewIsModal style={{ width: '100%', maxWidth: 400, backgroundColor: theme.surface, borderRadius: 20, padding: 24, gap: 16 }}><Text accessibilityRole="header" style={{ ...text, fontFamily: theme.font.displayStrong, fontSize: 22 }}>Delete bank account?</Text><Text style={text}>This account will be removed from your saved bank details. You can add an account again later.</Text><Pressable accessibilityRole="button" disabled={busy} onPress={() => void remove()} style={{ minHeight: 50, borderRadius: 12, backgroundColor: theme.error, justifyContent: 'center', alignItems: 'center' }}><Text style={{ ...text, color: '#FFFFFF', fontFamily: theme.font.semibold }}>{busy ? 'Deleting…' : 'Delete account'}</Text></Pressable><ToolButton secondary label="Keep account" disabled={busy} onPress={() => setConfirmDelete(false)} /></View></View>
    </Modal>
  </ToolPage>;
}

