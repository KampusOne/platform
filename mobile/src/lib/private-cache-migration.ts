import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getDeviceCacheRevision, isDeviceCacheOwner, readCache, readOwnedDraft, writeCache } from './device-cache';
import { ownedRecordKey } from './secure-snapshots';
import { secureSnapshots } from './secure-snapshots.native-adapter';
/** Preserve an existing draft; remove its plaintext copy only after native encrypted round-trip proof. */
export async function readMigratedPrivateCache(legacyKey:string,key:string,owner:string):Promise<string|null> {
  if(!isDeviceCacheOwner(owner)){
    if(ownedRecordKey(key))throw new Error('This draft belongs to a different session.');
    return null;
  }
  const revision=getDeviceCacheRevision(),current=()=>isDeviceCacheOwner(owner)&&revision===getDeviceCacheRevision();
  const saved=ownedRecordKey(key)?await readOwnedDraft<string>(key,revision):await readCache<string>(key);
  if(!current())throw new Error('This draft belongs to a different session.');
  if(saved!==null)return saved;
  const legacy=await AsyncStorage.getItem(legacyKey);if(!legacy||!current())return null;
  await writeCache(key,legacy);
  if(current()&&Platform.OS!=='web'&&(await secureSnapshots.read<string>(key))?.data===legacy&&current())await AsyncStorage.removeItem(legacyKey);
  if(!current())throw new Error('This draft belongs to a different session.');
  return legacy;
}
