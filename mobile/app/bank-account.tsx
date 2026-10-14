import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { ToolPage, ToolField, ToolButton } from '@/src/components/toolkit';
import { RetryIconButton } from '@/src/components/retry-icon-button';
import { useAppearance } from '@/src/lib/appearance';
import { useAuth } from '@/src/auth/auth-context';
import { cacheScopeForUser } from '@/src/lib/request-policy';
import { api, ApiError, invalidateApiReads } from '@/src/lib/api';
type Bank = { code: string; name: string };
type Account = { id: string; status: string; bank_name: string; account_name: string; account_last4: string };
type Profile = { id: string; display_name: string; agent_type: string; account: Account | null };
const statusLabel: Record<string, string> = { PENDING_PROVIDER: 'Verification pending', PENDING_REVIEW: 'Verification pending', APPROVED: 'Verified', REJECTED: 'Needs a new account', RESOLVING: 'Checking account' };
export default function BankAccount() {
  const { user } = useAuth();
  return <OwnedBankAccount key={user ? cacheScopeForUser(user) : 'anonymous'} />;
}
function OwnedBankAccount() {
  const { theme } = useAppearance(), params = useLocalSearchParams<{ profileId?: string }>();
  const [profiles, setProfiles] = useState<Profile[]>([]), [profileId, setProfileId] = useState(typeof params.profileId === 'string' ? params.profileId : '');
  const [banks, setBanks] = useState<Bank[]>([]), [bankCode, setBankCode] = useState(''), [query, setQuery] = useState(''), [choosing, setChoosing] = useState(false);
  const [editing, setEditing] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
  const [accountNumber, setAccountNumber] = useState(''), [accountName, setAccountName] = useState(''), [authorized, setAuthorized] = useState(false);
  const [ready, setReady] = useState(false), [providerAvailable, setProviderAvailable] = useState(false), [busy, setBusy] = useState(false), [looking, setLooking] = useState(false), [banksLoading, setBanksLoading] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [lookupAttempt, setLookupAttempt] = useState(0), [bankAttempt, setBankAttempt] = useState(0);
  const saving = useRef(false), requestId = useRef(''), alive = useRef(true), lookupVersion = useRef(0);
  const profile = profiles.find(p => p.id === profileId), bank = banks.find(b => b.code === bankCode);
  const showForm = Boolean(profile && (!profile.account || editing));
  const text = { color: theme.text, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21 }, muted = { ...text, color: theme.textMuted, fontSize: 13 };
  useEffect(() => { alive.current = true; return () => { alive.current = false; lookupVersion.current++; }; }, []);
  const load = useCallback(async () => {
    const setup = await api<{ profiles: Profile[]; providerAvailable: boolean }>('/v1/payout-setup', { cache: 'reload' });
    if (!alive.current) return;
    if (!Array.isArray(setup.profiles)) throw new Error('Your bank details could not be read. Please retry.');
    setProfiles(setup.profiles); setProviderAvailable(setup.providerAvailable); setReady(true);
    setProfileId(current => setup.profiles.some(p => p.id === current) ? current : setup.profiles[0]?.id ?? '');
  }, []);
  useFocusEffect(useCallback(() => {
    void load().catch(e => { if (alive.current) { setReady(true); setError(e instanceof Error ? e.message : 'Could not load your bank details.'); } });
  }, [load]));
  // Viewing a saved account must not spend a bank-list or name-lookup request.
  useEffect(() => {
    if (!showForm || !providerAvailable || banks.length) return;
    let active = true; setBanksLoading(true);
    void api<{ banks: Bank[] }>('/v1/payout-setup/banks').then(result => { if (!Array.isArray(result.banks)) throw new Error('The bank list could not be read. Please retry.'); if (active && alive.current) { setBanksLoading(false); setBanks(result.banks); } })
      .catch(e => { if (active && alive.current) setError(e.message); })
      .finally(() => { if (active && alive.current) setBanksLoading(false); });
    return () => { active = false; };
  }, [showForm, providerAvailable, banks.length, bankAttempt]);
  useEffect(() => {
    const version = ++lookupVersion.current; setAccountName(''); setLooking(false); requestId.current = '';
    if (!showForm || !profileId || !bankCode || !/^[0-9]{10}$/.test(accountNumber) || !authorized) return;
    const controller = new AbortController(), timer = setTimeout(() => {
      setLooking(true); setError('');
      void api<{ accountName: string }>('/v1/payout-setup/account-name', { method: 'POST', signal: controller.signal, timeoutMs: 15000, body: JSON.stringify({ agentProfileId: profileId, bankCode, accountNumber, authorizedAccount: true }) })
        .then(result => { if (alive.current && version === lookupVersion.current) setAccountName(result.accountName); })
        .catch(e => { if (alive.current && version === lookupVersion.current && !controller.signal.aborted) setError(e.message); })
        .finally(() => { if (alive.current && version === lookupVersion.current) setLooking(false); });
    }, 600);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [showForm, profileId, bankCode, accountNumber, authorized, lookupAttempt]);
  function clearForm() {
    lookupVersion.current++; requestId.current = ''; setAccountNumber(''); setAccountName(''); setAuthorized(false); setBankCode(''); setChoosing(false); setQuery(''); setConfirmDelete(false); setNotice(''); setError('');
  }
  function invalidateBankViews() { invalidateApiReads(['/v1/payout-setup', '/v1/agents', '/v1/earnings']); }
  async function save() {
    if (saving.current || !accountName || !authorized || !profileId) return;
    saving.current = true; setBusy(true); setError(''); setNotice(''); const targetProfile = profileId;
    requestId.current ||= Crypto.randomUUID();
    try {
      const result = await api<{ account: Account }>('/v1/payout-setup/resolve', { method: 'POST', timeoutMs: 30000, body: JSON.stringify({ agentProfileId: targetProfile, bankCode, accountNumber, requestId: requestId.current, authorizedAccount: true }) });
      if (!alive.current) return;
      if (!result.account?.id) throw new Error('The saved bank receipt could not be read. Refresh before trying again.');
      invalidateBankViews(); setProfiles(old => old.map(p => p.id === targetProfile ? { ...p, account: result.account } : p)); clearForm(); setEditing(false); setNotice('Bank account saved.');
    } catch (e) {
      if (e instanceof ApiError && e.details?.restartRequired === true) requestId.current = '';
      if (alive.current) setError(e instanceof Error ? e.message : 'Bank details could not be saved.');
    } finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  async function remove() {
    const account = profile?.account, targetProfile = profileId; if (!account?.id || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const result = await api<{ deleted: boolean }>('/v1/payout-setup/' + account.id, { method: 'DELETE', timeoutMs: 30000 });
      if (!alive.current) return;
      if (!result.deleted) throw new Error('Removal was not confirmed. Refresh your bank details.');
      invalidateBankViews(); setProfiles(old => old.map(p => p.id === targetProfile && p.account?.id === account.id ? { ...p, account: null } : p)); clearForm(); setEditing(false); setNotice('Bank account removed.');
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Could not remove your bank account.'); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  const actionStyle = { minHeight: 44, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7, paddingVertical: 10 };
  return <ToolPage title="Bank account">
    {error ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}><Text accessibilityRole="alert" style={{ ...text, color: theme.error, flex: 1 }}>{error}</Text><RetryIconButton label="Retry bank details" disabled={busy || looking} onPress={() => { setError(''); setLookupAttempt(v => v + 1); setBankAttempt(v => v + 1); void load().catch(e => { if (alive.current) setError(e.message); }); }} /></View> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={{ ...muted, marginBottom: 16 }}>{notice}</Text> : null}
    {!ready ? <Text style={muted}>Loading bank details…</Text> : !profiles.length ? (error ? null : <Text style={text}>An approved agent profile is required.</Text>) : <>
      {profiles.length > 1 ? <View style={{ flexDirection: 'row', gap: 20, marginBottom: 18 }}>{profiles.map(p => <Pressable key={p.id} accessibilityRole="radio" accessibilityState={{ checked: p.id === profileId }} disabled={busy} onPress={() => { clearForm(); setEditing(false); setProfileId(p.id); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ ...text, color: p.id === profileId ? theme.deepBrand : theme.textMuted }}>{p.display_name}</Text></Pressable>)}</View> : null}
      {profile?.account && !editing ? <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 18, backgroundColor: theme.surface, gap: 6 }}>
        <Text style={{ ...text, fontFamily: theme.font.semibold, fontSize: 16 }}>{profile.account.bank_name || 'Saved bank account'}</Text><Text style={muted}>•••• {profile.account.account_last4}</Text><Text style={{ ...text, marginTop: 8 }}>{profile.account.account_name}</Text><Text style={muted}>{statusLabel[profile.account.status] ?? 'Account saved'}</Text>
        {confirmDelete ? <View style={{ borderTopWidth: 1, borderColor: theme.border, marginTop: 12, paddingTop: 14, gap: 8 }}><Text style={text}>Remove this bank account?</Text><Text style={muted}>Add a verified account again before withdrawing.</Text><View style={{ flexDirection: 'row', gap: 26 }}><Pressable accessibilityRole="button" accessibilityLabel="Confirm bank account removal" disabled={busy} onPress={() => void remove()} style={actionStyle}><Text style={{ ...text, color: theme.error, fontFamily: theme.font.semibold }}>{busy ? 'Removing…' : 'Remove account'}</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirmDelete(false)} style={actionStyle}><Text style={text}>Cancel</Text></Pressable></View></View>
          : <View style={{ flexDirection: 'row', gap: 26, borderTopWidth: 1, borderColor: theme.border, marginTop: 12, paddingTop: 4 }}><Pressable accessibilityRole="button" disabled={busy} onPress={() => { clearForm(); setEditing(true); }} style={actionStyle}><Ionicons name="create-outline" size={18} color={theme.deepBrand} /><Text style={{ ...text, color: theme.deepBrand }}>Change</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => { setError(''); setConfirmDelete(true); }} style={actionStyle}><Ionicons name="trash-outline" size={18} color={theme.error} /><Text style={{ ...text, color: theme.error }}>Delete</Text></Pressable></View>}
      </View> : null}
      {showForm ? <View style={{ gap: 12 }}>
        {editing ? <Text style={{ ...text, fontFamily: theme.font.semibold, fontSize: 17, marginBottom: 4 }}>Change bank account</Text> : null}
        {!providerAvailable ? <Text style={muted}>Bank verification is temporarily unavailable. Try again shortly.</Text> : null}
        <View><Text style={{ ...text, marginBottom: 8 }}>Bank</Text><Pressable accessibilityRole="button" accessibilityLabel="Choose bank" accessibilityState={{ expanded: choosing, disabled: busy || banksLoading || !providerAvailable }} disabled={busy || banksLoading || !providerAvailable} onPress={() => setChoosing(v => !v)} style={{ minHeight: 52, paddingHorizontal: 14, borderWidth: 1, borderColor: theme.border, borderRadius: 12, backgroundColor: theme.surface, flexDirection: 'row', alignItems: 'center', gap: 10 }}><Text style={{ ...text, flex: 1, color: bank ? theme.text : theme.textMuted }}>{banksLoading ? 'Loading banks…' : bank?.name ?? 'Select your bank'}</Text><Ionicons name={choosing ? 'chevron-up' : 'chevron-down'} size={18} color={theme.textMuted} /></Pressable></View>
        {choosing ? <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12, backgroundColor: theme.surface }}><ToolField label="Search banks" value={query} onChangeText={setQuery} autoFocus />{banks.filter(b => b.name.toLowerCase().includes(query.toLowerCase())).slice(0, 10).map(b => <Pressable key={b.code} accessibilityRole="button" onPress={() => { lookupVersion.current++; setAccountName(''); setAuthorized(false); setBankCode(b.code); setChoosing(false); setQuery(''); }} style={{ minHeight: 48, paddingVertical: 12 }}><Text style={text}>{b.name}</Text></Pressable>)}{!banks.some(b => b.name.toLowerCase().includes(query.toLowerCase())) ? <Text style={muted}>No matching bank.</Text> : null}</View> : null}
        <ToolField label="Account number" placeholder="10-digit account number" keyboardType="number-pad" autoComplete="off" maxLength={10} value={accountNumber} editable={!busy && providerAvailable} onChangeText={value => { lookupVersion.current++; setAccountName(''); setAuthorized(false); setNotice(''); setAccountNumber(value.replace(/\D/g, '')); }} />
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: authorized, disabled: busy || !providerAvailable }} disabled={busy || !providerAvailable} onPress={() => setAuthorized(v => !v)} style={{ ...actionStyle, alignItems: 'flex-start', paddingVertical: 4 }}><Ionicons name={authorized ? 'checkbox' : 'square-outline'} size={22} color={theme.deepBrand} /><Text style={{ ...text, flex: 1 }}>I own or am authorised to use this account.</Text></Pressable>
        {looking ? <Text accessibilityLiveRegion="polite" style={muted}>Checking account name…</Text> : accountName ? <View style={{ paddingVertical: 8 }}><Text style={muted}>Account name</Text><Text style={{ ...text, fontFamily: theme.font.semibold, marginTop: 4 }}>{accountName}</Text></View> : null}
        <ToolButton label={busy ? 'Saving…' : 'Save account'} disabled={busy || !accountName || looking || !authorized || !providerAvailable} onPress={() => void save()} />
        {editing ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => { clearForm(); setEditing(false); }} style={{ ...actionStyle, justifyContent: 'center' }}><Text style={muted}>Cancel</Text></Pressable> : null}
      </View> : null}
    </>}
  </ToolPage>;
}
