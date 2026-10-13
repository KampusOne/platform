import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { ToolPage, ToolField, ToolButton, ToolRow } from '@/src/components/toolkit';
import { RetryIconButton } from '@/src/components/retry-icon-button';
import { useAppearance } from '@/src/lib/appearance';
import { useAuth } from '@/src/auth/auth-context';
import { api, ApiError } from '@/src/lib/api';
type Bank = {
    code: string;
    name: string;
};
type Account = {
    status: string;
    bank_name: string;
    account_name: string;
    account_last4: string;
};
type Profile = {
    id: string;
    display_name: string;
    agent_type: string;
    account: Account | null;
};
export default function BankAccount() { const { user } = useAuth(); return <OwnedBankAccount key={user?.id ?? 'anonymous'}/>; }
function OwnedBankAccount() {
    const { theme } = useAppearance(), params = useLocalSearchParams<{
        profileId?: string;
    }>();
    const [profiles, setProfiles] = useState<Profile[]>([]), [profileId, setProfileId] = useState(params.profileId ?? '');
    const [banks, setBanks] = useState<Bank[]>([]), [bankCode, setBankCode] = useState(''), [query, setQuery] = useState(''), [choosing, setChoosing] = useState(false);
    const [accountNumber, setAccountNumber] = useState(''), [accountName, setAccountName] = useState(''), [authorized, setAuthorized] = useState(false);
    const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [looking, setLooking] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [lookupAttempt, setLookupAttempt] = useState(0);
    const saving = useRef(false), request = useRef(''), alive = useRef(true), lookupVersion = useRef(0);
    useEffect(() => { alive.current = true; return () => { alive.current = false; lookupVersion.current++; }; }, []);
    const load = useCallback(async () => {
        const setup = await api<{
            profiles: Profile[];
            providerAvailable: boolean;
        }>('/v1/payout-setup', { cache: 'reload' });
        if (!alive.current)
            return;
        setProfiles(setup.profiles);
        setReady(true);
        setError('');
        setProfileId(current => setup.profiles.some(p => p.id === current) ? current : setup.profiles[0]?.id ?? '');
        if (!setup.providerAvailable) {
            setError('Bank verification is unavailable. Your saved account is still listed below.');
            return;
        }
        const list = await api<{
            banks: Bank[];
        }>('/v1/payout-setup/banks');
        if (alive.current)
            setBanks(list.banks);
    }, []);
    useFocusEffect(useCallback(() => { void load().catch(e => { if (alive.current) {
        setReady(true);
        setError(e.message);
    } }); }, [load]));
    useEffect(() => {
        const version = ++lookupVersion.current;
        setAccountName('');
        setLooking(false);
        request.current = '';
        if (!profileId || !bankCode || !/^[0-9]{10}$/.test(accountNumber) || !authorized)
            return;
        const controller = new AbortController(), timer = setTimeout(() => {
            setLooking(true);
            setError('');
            void api<{
                accountName: string;
            }>('/v1/payout-setup/account-name', { method: 'POST', signal: controller.signal, timeoutMs: 15000, body: JSON.stringify({ agentProfileId: profileId, bankCode, accountNumber, authorizedAccount: true }) })
                .then(r => { if (alive.current && version === lookupVersion.current)
                setAccountName(r.accountName); })
                .catch(e => { if (alive.current && version === lookupVersion.current && !controller.signal.aborted)
                setError(e.message); })
                .finally(() => { if (alive.current && version === lookupVersion.current)
                setLooking(false); });
        }, 600);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [profileId, bankCode, accountNumber, authorized, lookupAttempt]);
    async function save() {
        if (saving.current || !accountName || !authorized)
            return;
        saving.current = true;
        setBusy(true);
        setError('');
        setNotice('');
        const requestId = request.current || Crypto.randomUUID();
        request.current = requestId;
        try {
            const r = await api<{
                account: Account;
            }>('/v1/payout-setup/resolve', { method: 'POST', timeoutMs: 30000, body: JSON.stringify({ agentProfileId: profileId, bankCode, accountNumber, requestId, authorizedAccount: true }) });
            if (!alive.current)
                return;
            setProfiles(old => old.map(p => p.id === profileId ? { ...p, account: r.account } : p));
            setAccountNumber('');
            setAuthorized(false);
            setNotice('Bank account saved. Approval is pending.');
        }
        catch (e) {
            if (e instanceof ApiError && e.details?.restartRequired === true)
                request.current = '';
            if (alive.current)
                setError(e instanceof Error ? e.message : 'Bank details could not be saved.');
        }
        finally {
            saving.current = false;
            if (alive.current)
                setBusy(false);
        }
    }
    const profile = profiles.find(p => p.id === profileId), bank = banks.find(b => b.code === bankCode);
    return <ToolPage title="Bank account">
    {error ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text accessibilityRole="alert" style={{ color: theme.error, flex: 1 }}>{error}</Text><RetryIconButton label="Retry bank verification" onPress={() => { setLookupAttempt(v => v + 1); void load().catch(e => setError(e.message)); }} disabled={busy || looking}/></View> : null}
    {!ready ? <Text style={{ color: theme.textMuted }}>Loading bank details…</Text> : !profiles.length ? <Text style={{ color: theme.text }}>An approved agent profile is required.</Text> : <>
      {profiles.length > 1 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{profiles.map(p => <Pressable key={p.id} disabled={busy} onPress={() => { lookupVersion.current++; setAccountName(''); setAuthorized(false); setProfileId(p.id); }}><Text style={{ color: p.id === profileId ? theme.brand : theme.textMuted, paddingVertical: 12 }}>{p.agent_type}</Text></Pressable>)}</View> : null}
      {profile?.account ? <View style={{ marginBottom: 20 }}><ToolRow title={profile.account.bank_name} detail={'••' + profile.account.account_last4}/><Text style={{ color: theme.text }}>{profile.account.account_name}</Text><Text style={{ color: theme.textMuted, marginTop: 5 }}>{profile.account.status.replaceAll('_', ' ').toLowerCase()}</Text></View> : null}
      <ToolButton secondary label={bank?.name ?? 'Choose bank'} disabled={busy} onPress={() => setChoosing(v => !v)}/>
      {choosing ? <><ToolField label="Search banks" value={query} onChangeText={setQuery}/>{banks.filter(b => b.name.toLowerCase().includes(query.toLowerCase())).slice(0, 12).map(b => <Pressable key={b.code} disabled={busy} onPress={() => { lookupVersion.current++; setAccountName(''); setAuthorized(false); setBankCode(b.code); setChoosing(false); setQuery(''); }} style={{ paddingVertical: 14, borderBottomWidth: 1, borderColor: theme.border }}><Text style={{ color: theme.text }}>{b.name}</Text></Pressable>)}</> : null}
      <ToolField label="Account number" keyboardType="number-pad" autoComplete="off" maxLength={10} value={accountNumber} editable={!busy} onChangeText={v => { lookupVersion.current++; setAccountName(''); setAuthorized(false); setAccountNumber(v.replace(/\D/g, '')); }}/>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: authorized }} disabled={busy} onPress={() => setAuthorized(v => !v)} style={{ flexDirection: 'row', gap: 10, paddingVertical: 14 }}><Ionicons name={authorized ? 'checkbox' : 'square-outline'} size={23} color={theme.brand}/><Text style={{ color: theme.text, flex: 1 }}>This is my authorized bank account.</Text></Pressable>
      {looking ? <Text style={{ color: theme.textMuted, marginVertical: 10 }}>Checking account name…</Text> : accountName ? <Text style={{ color: theme.text, fontFamily: theme.font.bold, marginVertical: 10 }}>{accountName}</Text> : null}
      <ToolButton label={busy ? 'Saving…' : 'Save bank account'} disabled={busy || !accountName || looking || !authorized} onPress={() => void save()}/>
      {notice ? <Text accessibilityRole="alert" style={{ color: theme.text, marginTop: 16 }}>{notice}</Text> : null}
    </>}
  </ToolPage>;
}
