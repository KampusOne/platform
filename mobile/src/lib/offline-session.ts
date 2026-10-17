import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { Session, SessionUser } from './api-transport';
import { readRefreshToken } from './session-storage';

const key = 'kampusone.offline-session.v1';
// Identity restores account-scoped read caches only. No access token, financial
// entitlement or permission is accepted from an offline snapshot.
export async function saveOfflineSession(session: Session) {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(key, JSON.stringify({
    user: session.user,
    expiresAt: Date.now() + Math.min(session.refreshExpiresIn, 30 * 86400) * 1000,
  }), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
export async function readOfflineSession(): Promise<SessionUser | null> {
  if (Platform.OS === 'web' || !await readRefreshToken()) return null;
  try {
    const saved = JSON.parse(await SecureStore.getItemAsync(key) ?? 'null');
    const user = saved?.user;
    if (!user || !Number.isFinite(saved.expiresAt) || saved.expiresAt <= Date.now() ||
      typeof user.id !== 'string' || typeof user.email !== 'string' ||
      !Array.isArray(user.roles) || !Array.isArray(user.operatorRoles) ||
      !(user.universityId === null || typeof user.universityId === 'string')) return null;
    return user;
  } catch { return null; }
}
export async function removeOfflineSession() {
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(key);
}
