import AsyncStorage from "@react-native-async-storage/async-storage";
const PREFIX = "k1.cache.v2.";
export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const record = JSON.parse(raw);
    return record.expires > Date.now() ? (record.data as T) : null;
  } catch {
    return null;
  }
}
export async function writeCache(
  key: string,
  data: unknown,
  ttl = 7 * 86400_000,
) {
  try {
    await AsyncStorage.setItem(
      PREFIX + key,
      JSON.stringify({ data, expires: Date.now() + ttl }),
    );
  } catch {
    /* Storage pressure must not break a successful server operation. */
  }
}
export async function clearDeviceCache() {
  // Remove the restore pointer first, even if bulk cache cleanup is interrupted.
  await AsyncStorage.removeItem(PREFIX + "last-session");
  const keys = (await AsyncStorage.getAllKeys()).filter((key) =>
    key.startsWith(PREFIX),
  );
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
