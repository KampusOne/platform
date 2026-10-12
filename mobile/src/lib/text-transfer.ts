import { getDeviceCacheRevision, isDeviceCacheOwner } from './device-cache';
import type { PendingText } from './text-retry-coordinator';
const transfers = new Map<string, {
    signature: string;
    promise: Promise<void>;
}>();
const validId = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
/** Initial UI send and retry worker share only the same account, session, thread and exact text intent. */
export function transferTextOnce(account: string, thread: string, message: PendingText, operation: (checkScope: () => void) => Promise<void>): Promise<void> {
    if (!validId(account) || !validId(thread) || !validId(message.id) || typeof message.body !== 'string' || !message.body.trim() || message.body.length > 5000 || message.replyToMessageId !== undefined && !validId(message.replyToMessageId))
        return Promise.reject(new Error('This pending text needs review before it can be sent.'));
    const revision = getDeviceCacheRevision();
    const checkScope = () => { if (revision !== getDeviceCacheRevision() || !isDeviceCacheOwner(account)) {
        const error = new Error('Your session changed. The text is kept in its original account.') as Error & {
            code: string;
        };
        error.code = 'SESSION_CHANGED';
        throw error;
    } };
    try {
        checkScope();
    }
    catch (error) {
        return Promise.reject(error);
    }
    const key = JSON.stringify([revision, account, thread, message.id]), signature = JSON.stringify([message.body, message.replyToMessageId ?? null]);
    const current = transfers.get(key);
    if (current) {
        if (current.signature !== signature)
            return Promise.reject(new Error('This pending message has different text. Retry its original text.'));
        return current.promise;
    }
    const promise = Promise.resolve().then(() => { checkScope(); return operation(checkScope); });
    const entry = { signature, promise };
    transfers.set(key, entry);
    void promise.finally(() => { if (transfers.get(key) === entry)
        transfers.delete(key); }).catch(() => undefined);
    return promise;
}
