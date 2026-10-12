// CI-only entry point. Never referenced by the production package.json or router.
import { registerRootComponent } from 'expo';
import * as Crypto from 'expo-crypto';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { readOwnedDraft, saveOwnedDraft, setDeviceCacheScope } from '../src/lib/device-cache';
import { secureSnapshots } from '../src/lib/secure-snapshots.native-adapter';
import { privateDraftStorage } from '../src/lib/private-draft-storage';

const owner = '11111111-1111-4111-8111-111111111111';
const campus = '33333333-3333-4333-8333-333333333333';
const other = '22222222-2222-4222-8222-222222222222';
const thread = '44444444-4444-4444-8444-444444444444';
const kira = 'ai-workspace-v3.' + owner;
const dm = 'kampusone.message-draft.v1.' + owner + '.' + thread;
const text = 'Native restart draft: GST, ₦6,000, café 🥂';
const marker = 'native.storage.smoke.phase';
const scope = (user: string, university = campus) => JSON.stringify([user, university, ['STUDENT'], []]);
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

async function smoke() {
  const phase = await AsyncStorage.getItem(marker);
  setDeviceCacheScope(scope(owner), owner);
  if (!phase) {
    const key = await Crypto.AESEncryptionKey.generate();
    const sealed = await Crypto.aesEncryptAsync(new TextEncoder().encode(text), key);
    let reproduced = false;
    try { Crypto.AESSealedData.fromCombined(await sealed.combined('base64')); } catch { reproduced = true; }
    check(reproduced, 'Expected the installed Android string bridge failure to reproduce');
    await saveOwnedDraft(kira, { prompt: text, turns: [], workspace: 'ask' });
    const draft = JSON.stringify({ version: 1, text, media: [], batches: [] });
    await privateDraftStorage.setItem(dm, draft);
    check((await readOwnedDraft<{prompt:string}>(kira))?.prompt === text, 'Kira write verification failed');
    check(await privateDraftStorage.getItem(dm) === draft, 'DM write verification failed');
    const records = (await AsyncStorage.getAllKeys()).filter(name => name.startsWith('k1.encrypted.v1.'));
    const raw = (await AsyncStorage.multiGet(records)).map(([,value]) => value ?? '').join('');
    check(records.length >= 4 && !raw.includes('Native restart draft'), 'Plaintext leaked into storage');
    await AsyncStorage.setItem(marker, 'restart');
    return 'NATIVE_STORAGE_WRITE_PASS';
  }
  check((await readOwnedDraft<{prompt:string}>(kira))?.prompt === text, 'Kira cold restart lost draft');
  check(JSON.parse((await privateDraftStorage.getItem(dm))!).text === text, 'DM cold restart lost draft');
  setDeviceCacheScope(scope(other), other);
  check(await secureSnapshots.read(kira) === null && await privateDraftStorage.getItem(dm) === null, 'Another account read a draft');
  setDeviceCacheScope(scope(owner, other), owner);
  check(await secureSnapshots.read(kira) === null, 'Another campus read a draft');
  setDeviceCacheScope(scope(owner), owner);
  check((await secureSnapshots.read<{prompt:string}>(kira))?.data.prompt === text, 'Original owner recovery failed');
  const location = (await AsyncStorage.getAllKeys()).find(name => name.startsWith('k1.encrypted.v1.') && !name.endsWith('.index') && !name.endsWith('.scopes'))!;
  const before = (await AsyncStorage.getItem(location))!;
  const envelope = JSON.parse(before);
  envelope.sealed = (envelope.sealed[0] === 'A' ? 'B' : 'A') + envelope.sealed.slice(1);
  await AsyncStorage.setItem(location, JSON.stringify(envelope));
  // At least one strict record read must fail, and the corrupted saved copy must survive.
  const checks = await Promise.allSettled([secureSnapshots.read(kira,{requireIntegrity:true}),secureSnapshots.read('message-draft.'+owner+'.'+thread,{requireIntegrity:true}),secureSnapshots.read('message-draft.'+owner+'.index',{requireIntegrity:true})]);
  check(checks.some(result => result.status === 'rejected'), 'Tampered data was accepted');
  check(await AsyncStorage.getItem(location) === JSON.stringify(envelope), 'Tampered draft was discarded');
  await AsyncStorage.setItem(location, before);
  return 'NATIVE_STORAGE_RESTART_PASS';
}
function SmokeApp() {
  const [status, setStatus] = useState('NATIVE_STORAGE_RUNNING');
  useEffect(() => {
    void SplashScreen.hideAsync();
    void smoke().then(setStatus).catch(error => setStatus('NATIVE_STORAGE_FAIL: ' + (error instanceof Error ? error.message : String(error))));
  }, []);
  return <View style={{flex:1,backgroundColor:'white',padding:24,justifyContent:'center'}}><Text testID="native-storage-result" style={{color:'black',fontSize:18}}>{status}</Text></View>;
}
registerRootComponent(SmokeApp);
