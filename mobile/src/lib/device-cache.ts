import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "k1.cache.v2.";
const memory = new Map<string, { data: unknown; expires: number }>();
const maxMemoryEntries = 40;

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
  const hot = memory.get(key);
  if (hot) {
    if (hot.expires > Date.now()) {
      memory.delete(key);
      memory.set(key, hot);
      return hot.data as T;
    }
    memory.delete(key);
  }
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const record = JSON.parse(raw) as { data: T; expires: number };
    if (!Number.isFinite(record.expires) || record.expires <= Date.now()) {
      void AsyncStorage.removeItem(PREFIX + key);
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
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(record));
  } catch {
    /* Storage pressure must not break a successful server operation. */
  }
}

export async function clearDeviceCache() {
  memory.clear();
  await AsyncStorage.removeItem(PREFIX + "last-session");
  const keys = (await AsyncStorage.getAllKeys()).filter((key) =>
    key.startsWith(PREFIX),
  );
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
