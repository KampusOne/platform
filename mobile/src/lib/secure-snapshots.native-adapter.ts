import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { SecureSnapshots } from './secure-snapshots';
const keyName = (id: string) => 'kampusone.snapshot-key.' + id;
const encoder = new TextEncoder(), decoder = new TextDecoder();
async function cryptoKey(id: string, create: boolean) {
  const [Crypto, SecureStore] = await Promise.all([import('expo-crypto'), import('expo-secure-store')]);
  if (Platform.OS === 'web' || !await SecureStore.isAvailableAsync()) throw new Error('Secure snapshots unavailable');
  const saved = await SecureStore.getItemAsync(keyName(id));
  if (saved) return Crypto.AESEncryptionKey.import(saved, 'base64');
  if (!create) return null;
  const key = await Crypto.AESEncryptionKey.generate();
  await SecureStore.setItemAsync(keyName(id), await key.encoded('base64'), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  return key;
}
export const secureSnapshots = new SecureSnapshots({
  get: key => AsyncStorage.getItem(key), set: (key,value) => AsyncStorage.setItem(key,value),
  remove: key => AsyncStorage.removeItem(key), keys: () => AsyncStorage.getAllKeys(),
  hash: async value => (await import('expo-crypto')).digestStringAsync((await import('expo-crypto')).CryptoDigestAlgorithm.SHA256,value),
  seal: async (id,text,aad) => {
    const Crypto = await import('expo-crypto'), key = await cryptoKey(id,true);
    if (!key) throw new Error('Secure snapshots unavailable');
    return (await Crypto.aesEncryptAsync(encoder.encode(text),key,{additionalData:encoder.encode(aad)})).combined('base64');
  },
  open: async (id,sealed,aad) => {
    const Crypto = await import('expo-crypto'), key = await cryptoKey(id,false);
    if (!key) return null;
    return decoder.decode(await Crypto.aesDecryptAsync(Crypto.AESSealedData.fromCombined(sealed),key,{additionalData:encoder.encode(aad)}));
  },
  destroyKey: async id => { if (Platform.OS !== 'web') await (await import('expo-secure-store')).deleteItemAsync(keyName(id)); },
});
