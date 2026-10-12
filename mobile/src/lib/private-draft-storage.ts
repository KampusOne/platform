import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { secureSnapshots } from './secure-snapshots.native-adapter';
import { getDeviceCacheRevision, isDeviceCacheOwner, readCache, writeCache } from './device-cache';
let indexQueue: Promise<void> = Promise.resolve();
const logical = (key: string) => key.replace('kampusone.message-draft.v1.', 'message-draft.');
const owner = (key: string) => logical(key).slice('message-draft.'.length).split('.')[0]!;
const validKey = (key: unknown, user: string): key is string => typeof key === 'string' && key.startsWith('kampusone.message-draft.v1.' + user + '.') && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(key.slice(('kampusone.message-draft.v1.' + user + '.').length));
const durableTtl = () => Number.MAX_SAFE_INTEGER - Date.now();
async function readValue(name: string): Promise<string | null> {
    return Platform.OS === 'web' ? readCache<string>(name) : (await secureSnapshots.read<string>(name))?.data ?? null;
}
async function writeValue(name: string, value: string | readonly string[], ttl: number) {
    if (Platform.OS === 'web')
        await writeCache(name, value, ttl);
    else
        await secureSnapshots.write(name, value, ttl);
    const proof = Platform.OS === 'web' ? await readCache<unknown>(name) : (await secureSnapshots.read<unknown>(name))?.data;
    if (JSON.stringify(proof) !== JSON.stringify(value))
        throw new Error('Your draft could not be saved securely on this device.');
}
async function readIndex(user: string): Promise<string[]> {
    const name = 'message-draft.' + user + '.index';
    const value = Platform.OS === 'web' ? await readCache<unknown>(name) : (await secureSnapshots.read<unknown>(name))?.data;
    if (value == null)
        return [];
    if (!Array.isArray(value) || value.some(key => !validKey(key, user)))
        throw new Error('Your saved draft list needs recovery before another draft can be added.');
    return [...new Set(value)] as string[];
}
function emptyDraft(raw: string | null) {
    if (!raw)
        return true;
    try {
        const draft = JSON.parse(raw);
        return draft?.version === 1 && typeof draft.text === 'string' && Array.isArray(draft.media) && Array.isArray(draft.batches) && !draft.text.trim() && !draft.pendingText && !draft.voice && !draft.reply && !draft.media.length && !draft.batches.length;
    }
    catch {
        return false;
    }
}
export const privateDraftStorage = {
    async getItem(key: string): Promise<string | null> {
        const user = owner(key);
        if (!validKey(key, user) || !isDeviceCacheOwner(user))
            return null;
        const revision = getDeviceCacheRevision(), name = logical(key);
        const saved = await readValue(name);
        if (revision !== getDeviceCacheRevision() || !isDeviceCacheOwner(user))
            return null;
        if (saved !== null)
            return saved || null;
        // Legacy plaintext can recover a manual draft only after server-verified account restoration.
        let legacy = await AsyncStorage.getItem(key);
        if (!legacy || revision !== getDeviceCacheRevision() || !isDeviceCacheOwner(user))
            return null;
        try {
            const record = JSON.parse(legacy);
            if (record && typeof record === 'object') {
                if (record.pendingText && typeof record.pendingText === 'object')
                    delete record.pendingText.retry;
                delete record.closedTextIds;
                legacy = JSON.stringify(record);
            }
        }
        catch { /* Normal draft parsing rejects malformed content. */ }
        await this.setItem(key, legacy);
        return legacy;
    },
    setItem(key: string, value: string): Promise<void> {
        const user = owner(key), revision = getDeviceCacheRevision();
        const check = () => { if (!validKey(key, user) || revision !== getDeviceCacheRevision() || !isDeviceCacheOwner(user))
            throw new Error('This draft belongs to a different session.'); };
        // Reserve and verify discovery metadata before committing an automatically retryable payload.
        const task = indexQueue.then(async () => {
            check();
            const index = await readIndex(user);
            check();
            if (!index.includes(key)) {
                while (index.length >= 40) {
                    let evict = -1;
                    for (let i = 0; i < index.length; i++) {
                        const candidate = await readValue(logical(index[i]!));
                        check();
                        if (emptyDraft(candidate)) {
                            evict = i;
                            break;
                        }
                    }
                    if (evict < 0)
                        throw new Error('You have 40 saved conversation drafts. Send or clear one before saving another. Your existing drafts are kept.');
                    index.splice(evict, 1);
                }
                index.push(key);
                await writeValue('message-draft.' + user + '.index', index, durableTtl());
                check();
            }
            await writeValue(logical(key), value, emptyDraft(value) ? 7 * 86400000 : durableTtl());
            check();
            await AsyncStorage.removeItem(key);
        });
        indexQueue = task.catch(() => undefined);
        return task;
    },
    async removeItem(key: string) { if (!isDeviceCacheOwner(owner(key)))
        return; await this.setItem(key, ''); await AsyncStorage.removeItem(key); },
    async keys(account: string) {
        if (!isDeviceCacheOwner(account))
            return [];
        const revision = getDeviceCacheRevision(), index = await readIndex(account);
        const legacy = (await AsyncStorage.getAllKeys()).filter(key => validKey(key, account));
        if (revision !== getDeviceCacheRevision() || !isDeviceCacheOwner(account))
            return [];
        return [...new Set([...index, ...legacy])];
    },
};
