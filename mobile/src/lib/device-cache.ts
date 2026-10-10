import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "k1.cache.v2.";
const memory = new Map<string, { data: unknown; expires: number }>();
const maxMemoryEntries = 40;
let generation = 0;
let storageQueue: Promise<void> = Promise.resolve();
// Persist only non-content bookkeeping. Profiles, last-session and unknown
// future payloads stay in RAM instead of unencrypted shared device storage.
const diskSafe = (key: string) => /^(?:streak\.open\.|push-device\.)[0-9a-f-]{36}$/i.test(key);
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
    const oldest = memory.keys().next().value as string | undefined;
    if (!oldest) break;
    memory.delete(oldest);
  }
}

export async function readCache<T>(key: string): Promise<T | null> {
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
  if (!diskSafe(key)) return null;
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
  ttl = 7 * 86400_000,
) {
  const record = { data, expires: Date.now() + ttl };
  remember(key, record);
  if (!diskSafe(key)) {
    await storageOperation(() => AsyncStorage.removeItem(PREFIX + key)).catch(() => undefined);
    return;
  }
  const versionAtStart = generation;
  try {
    await storageOperation(async () => {
      if (generation === versionAtStart) await AsyncStorage.setItem(PREFIX + key, JSON.stringify(record));
    });
  } catch {
    /* Storage pressure must not break a successful server operation. */
  }
}

export async function clearDeviceCache() {
  generation++;
  memory.clear();
  await storageOperation(async () => {
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  });
}
