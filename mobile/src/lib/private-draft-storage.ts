import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { secureSnapshots } from './secure-snapshots.native-adapter';
import { isDeviceCacheOwner, readCache, writeCache } from './device-cache';
let indexQueue: Promise<void> = Promise.resolve();
const logical = (key:string) => key.replace('kampusone.message-draft.v1.','message-draft.');
const owner = (key:string) => logical(key).slice('message-draft.'.length).split('.')[0]!;
export const privateDraftStorage = {
  async getItem(key:string):Promise<string|null> {
    const user=owner(key);if(!isDeviceCacheOwner(user))return null;
    const name=logical(key);
    if(Platform.OS==='web')return readCache<string>(name);
    const saved=await secureSnapshots.read<string>(name);if(saved)return saved.data;
    // Read legacy data only after matching server-verified account restoration.
    const legacy=await AsyncStorage.getItem(key);if(!legacy||!isDeviceCacheOwner(user))return null;
    await this.setItem(key,legacy);return legacy;
  },
  async setItem(key:string,value:string) {
    const user=owner(key);if(!isDeviceCacheOwner(user))throw new Error('This draft belongs to a different session.');
    const name=logical(key);
    if(Platform.OS==='web'){await writeCache(name,value);const indexKey='message-draft.'+user+'.index';const index=await readCache<string[]>(indexKey)??[];if(!index.includes(key))await writeCache(indexKey,[...index,key].slice(-40));return;}
    await secureSnapshots.write(name,value,7*86400_000);
    const proof=await secureSnapshots.read<string>(name);
    if(proof?.data!==value)throw new Error('Your draft could not be saved securely on this device.');
    await AsyncStorage.removeItem(key);
    const update = indexQueue.then(async()=>{const indexKey='message-draft.'+user+'.index';const index=(await secureSnapshots.read<string[]>(indexKey))?.data??[];if(!index.includes(key))await secureSnapshots.write(indexKey,[...index,key].slice(-40),7*86400_000);});
    indexQueue=update.catch(()=>undefined);await update;
  },
  async removeItem(key:string) { if(!isDeviceCacheOwner(owner(key)))return;await this.setItem(key,'');await AsyncStorage.removeItem(key); },
  async keys(account:string) {
    if(!isDeviceCacheOwner(account))return [];
    const index=Platform.OS==='web'?await readCache<string[]>('message-draft.'+account+'.index')??[]:(await secureSnapshots.read<string[]>('message-draft.'+account+'.index'))?.data??[];
    const legacy=(await AsyncStorage.getAllKeys()).filter(key=>key.startsWith('kampusone.message-draft.v1.'+account+'.'));
    return [...new Set([...index,...legacy])];
  },
};
