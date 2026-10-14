import { Platform } from "react-native";
import { secureSnapshots } from "./secure-snapshots.native-adapter";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ownedRecordKey, SnapshotReadError } from './secure-snapshots';

const PREFIX = "k1.cache.v2.";
const memory = new Map<string, { data: unknown; expires: number }>();
const maxMemoryEntries = 100;
let generation = 0;
let localWriteEpoch = 0;
let prunedWriteEpoch = 0;
const draftWrites = new Map<string, number>();
function noteDraftWrite(key: string) {
  if (!ownedRecordKey(key)) return;
  draftWrites.delete(key); draftWrites.set(key, ++localWriteEpoch);
  while (draftWrites.size > 256) {
    const oldest = draftWrites.keys().next().value!;
    prunedWriteEpoch = Math.max(prunedWriteEpoch, draftWrites.get(oldest)!);
    draftWrites.delete(oldest);
  }
}
let activeScope: string | null = null;
let activeOwner = "";
export const getDeviceCacheRevision=()=>generation;
export const isDeviceCacheOwner = (owner: string) => Boolean(activeScope && owner && activeOwner === owner);
export function setDeviceCacheScope(scope: string | null, owner = "") {
  if (scope === activeScope) return;
  generation++; memory.clear(); activeScope = scope; activeOwner = scope ? owner : "";
  draftWrites.clear(); prunedWriteEpoch = localWriteEpoch;
  secureSnapshots.activate(Platform.OS === "web" ? null : scope, owner);
}
let storageQueue: Promise<void> = Promise.resolve();
// Persist only non-content bookkeeping. Profiles, last-session and unknown
// future payloads stay in RAM instead of unencrypted shared device storage.
const diskSafe = (key: string) => /^(?:streak\.open\.|push-device\.)[0-9a-f-]{36}$/i.test(key);
const ownerKey = /^(?:profile|settings|home|payment-draft|timetable-draft|exam-draft|kira-draft|kira-plans|ai-draft|ai-workspace-v3|publishing-draft|publisher-draft|listing-draft|campus-activity-draft|answer-draft|message-draft|cart|search-recents|onboarding|calendar-editor-draft|business-profile-draft|calendar-local|telemetry)\./;
const permittedOwner = (key:string) => !ownerKey.test(key) || Boolean(activeScope && activeOwner && key.includes(activeOwner));
function storageOperation(operation: () => Promise<void>): Promise<void> {
  const next = storageQueue.then(operation, operation);
  storageQueue = next.catch(() => undefined);
  return next;
}

// Scrub legacy private snapshots without making startup wait for storage.
void storageOperation(async () => {
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(PREFIX) && !diskSafe(key.slice(PREFIX.length)));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}).catch(() => undefined);

function remember(key: string, record: { data: unknown; expires: number }) {
  memory.delete(key);
  memory.set(key, record);
  while (memory.size > maxMemoryEntries) {
    const oldest = [...memory.keys()].find(candidate=>!ownedRecordKey(candidate)||memory.get(candidate)!.expires<=Date.now());
    if (!oldest) break;
    memory.delete(oldest);
  }
  // Web has no encrypted disk fallback. Never evict an existing owned draft to cache another view.
  if(memory.size>maxMemoryEntries)memory.delete(key);
}

export async function readCache<T>(key: string): Promise<T | null> {
  if(!permittedOwner(key))return null;
  const versionAtStart = generation;
  if (!diskSafe(key)) void storageOperation(() => AsyncStorage.removeItem(PREFIX + key)).catch(() => undefined);
  const hot = memory.get(key);
  if (hot) {
    if (hot.expires > Date.now()) {
      memory.delete(key);
      memory.set(key, hot);
      return hot.data as T;
    }
    memory.delete(key);
  }
  if (!diskSafe(key)) {
    const record = await secureSnapshots.read<T>(key).catch(() => null);
    if (generation !== versionAtStart || !record) return null;
    remember(key, record); return record.data;
  }
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (generation !== versionAtStart) return null;
    if (!raw) return null;
    const record = JSON.parse(raw) as { data: T; expires: number };
    if (!Number.isFinite(record.expires) || record.expires <= Date.now()) {
      void storageOperation(async () => {
        if (generation === versionAtStart && await AsyncStorage.getItem(PREFIX + key) === raw)
          await AsyncStorage.removeItem(PREFIX + key);
      }).catch(() => undefined);
      return null;
    }
    remember(key, record);
    return record.data;
  } catch {
    return null;
  }
}

export async function writeCache(
  key: string,
  data: unknown,
  ttl = ownedRecordKey(key)?Number.MAX_SAFE_INTEGER-Date.now():7 * 86400_000,
) {
  if(!permittedOwner(key)||!Number.isFinite(ttl)||ttl<=0)return;
  noteDraftWrite(key);
  const versionAtStart=generation;
  const record = { data, expires: Date.now() + ttl };
  if(!key.startsWith('calendar-local.')||Platform.OS==='web')remember(key, record);
  if (!diskSafe(key)) {
    if(key.startsWith('calendar-local.')&&Platform.OS!=='web'){
      await secureSnapshots.write(key,data,ttl);
      const proof=await secureSnapshots.read(key);
      if(generation!==versionAtStart||!proof||JSON.stringify(proof.data)!==JSON.stringify(data))throw new Error('Your calendar could not be saved securely on this device. Keep your event open and try again.');
      remember(key,record);
      await storageOperation(()=>AsyncStorage.removeItem(PREFIX+key)).catch(()=>undefined);return;
    }
    await secureSnapshots.write(key, data, ttl).catch(() => undefined);
    await storageOperation(() => AsyncStorage.removeItem(PREFIX + key)).catch(() => undefined);
    return;
  }
  try {
    await storageOperation(async () => {
      if (generation === versionAtStart) await AsyncStorage.setItem(PREFIX + key, JSON.stringify(record));
    });
  } catch {
    /* Storage pressure must not break a successful server operation. */
  }
}

/** Primary user work must prove its encrypted write; display caches remain best effort. */
export async function readOwnedDraft<T>(key: string, revision = generation): Promise<T | null> {
  if (!ownedRecordKey(key) || !permittedOwner(key) || !activeScope || revision !== generation)
    throw new Error('This draft belongs to a different session.');
  const hot = memory.get(key);
  if (hot && hot.expires > Date.now()) return hot.data as T;
  if (Platform.OS === 'web') return null;
  const writesAtStart = localWriteEpoch;
  const keyWriteAtStart = draftWrites.get(key) ?? 0;
  let record;
  try { record = await secureSnapshots.read<T>(key, { requireIntegrity: true }); }
  catch { throw new SnapshotReadError(); }
  if (revision !== generation) throw new Error('This draft belongs to a different session.');
  if (keyWriteAtStart !== (draftWrites.get(key) ?? 0) || prunedWriteEpoch > writesAtStart) {
    const latest = memory.get(key);
    if (latest && latest.expires > Date.now()) return latest.data as T;
    throw new SnapshotReadError();
  }
  if (!record) return null;
  remember(key, record);
  return record.data;
}

export async function saveOwnedDraft(key: string, data: unknown, revision = generation): Promise<'device' | 'session'> {
  if (!ownedRecordKey(key) || !permittedOwner(key) || !activeScope || revision !== generation)
    throw new Error('This draft belongs to a different session.');
  noteDraftWrite(key);
  const record = { data, expires: Number.MAX_SAFE_INTEGER };
  remember(key, record); // Keep the current work visible even if durable storage is full.
  if (Platform.OS === 'web') {
    if (revision !== generation || JSON.stringify(memory.get(key)?.data) !== JSON.stringify(data))
      throw new Error('Your draft could not be kept in this browser session.');
    return 'session';
  }
  let proof;
  try {
    await secureSnapshots.write(key, data, Number.MAX_SAFE_INTEGER - Date.now());
    proof = await secureSnapshots.read(key, { requireIntegrity: true });
  } catch {
    throw new Error('Your draft could not be saved securely on this device. Keep this screen open and try again.');
  }
  if (revision !== generation || !proof || JSON.stringify(proof.data) !== JSON.stringify(data))
    throw new Error('Your draft could not be saved securely on this device. Keep this screen open and try again.');
  await storageOperation(() => AsyncStorage.removeItem(PREFIX + key)).catch(() => undefined);
  return 'device';
}

export async function clearDeviceCache() {
  generation++;
  memory.clear();
  draftWrites.clear(); prunedWriteEpoch = localWriteEpoch;
  activeScope = null;
  activeOwner = "";
  await secureSnapshots.clear();
  await storageOperation(async () => {
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(PREFIX) || /^(?:k1-foreground-usage:|k1\.message-upload\.|k1\.onboarding\.|k1\.search\.recents\.v1\.|kampusone\.message-draft\.v1\.|@kampusone\/calendar\/personal\/)/.test(key));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  });
  if(Platform.OS!=='web') {
    const {Directory,Paths}=await import('expo-file-system');
    const directory=new Directory(Paths.document,'message-drafts');
    if(directory.exists){for(const child of directory.list())if(child instanceof Directory&&!(activeOwner&&child.name.startsWith('kampusone.message-draft.v1.'+activeOwner+'.')))child.delete();}
  } else if(typeof indexedDB!=='undefined') {
    await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase('kampusone-message-drafts');request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>resolve();});
  }
}
