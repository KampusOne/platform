import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { isDeviceCacheOwner, readCache, writeCache } from './device-cache';
import { secureSnapshots } from './secure-snapshots.native-adapter';
/** Preserve an existing draft; remove its plaintext copy only after native encrypted round-trip proof. */
export async function readMigratedPrivateCache(legacyKey:string,key:string,owner:string):Promise<string|null> {
  if(!isDeviceCacheOwner(owner))return null;
  const saved=await readCache<string>(key);if(saved!==null)return saved;
  const legacy=await AsyncStorage.getItem(legacyKey);if(!legacy||!isDeviceCacheOwner(owner))return null;
  await writeCache(key,legacy);
  if(Platform.OS!=='web'&&(await secureSnapshots.read<string>(key))?.data===legacy)await AsyncStorage.removeItem(legacyKey);
  return legacy;
}
