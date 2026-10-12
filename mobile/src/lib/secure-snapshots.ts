/** Bounded, authenticated native snapshots. Credentials and authoritative money state never enter this store. */
export interface SnapshotIO {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
    keys(): Promise<readonly string[]>;
    hash(value: string): Promise<string>;
    seal(keyId: string, text: string, aad: string): Promise<string>;
    open(keyId: string, sealed: string, aad: string): Promise<string | null>;
    destroyKey(keyId: string): Promise<void>;
}
const prefix = 'k1.encrypted.v1.';
const maxRecord = 256 * 1024, maxBytes = 2 * 1024 * 1024, maxRecords = 60;
export class SnapshotReadError extends Error {
    constructor() {
        super('Your saved draft could not be restored. Its saved copy has been kept. Try again before editing.');
        this.name = 'SnapshotReadError';
    }
}
export const ownedRecordKey = (key: string) => /^(?:timetable-draft|exam-draft|kira-draft|ai-draft|ai-workspace-v3|publishing-draft|publisher-draft|listing-draft|campus-activity-draft|answer-draft|message-draft|cart|onboarding|calendar-editor-draft|business-profile-draft|calendar-local)\./.test(key);
type RecordValue<T> = {
    version: 1;
    data: T;
    expires: number;
    savedAt: number;
    protectedDraft?: boolean;
};
function protectedDraft(key: string, data: unknown) {
    if (key.startsWith('message-draft.') && !key.endsWith('.index')) {
        try {
            const draft = typeof data === 'string' ? JSON.parse(data) : data;
            return Boolean(draft && (draft.text?.trim() || draft.pendingText || draft.voice || draft.reply || draft.media?.length || draft.batches?.length));
        }
        catch {
            return true;
        }
    }
    return ownedRecordKey(key);
}
/** Atomic single-key payloads; writes/deletions are serialized, not a parallel JSON read-modify-write. */
export class SecureSnapshots {
    private scope: {
        value: string;
        owner: string;
        epoch: number;
    } | null = null;
    private epoch = 0;
    private queue: Promise<unknown> = Promise.resolve();
    constructor(private io: SnapshotIO, private now = Date.now) { }
    activate(value: string | null, owner = '') {
        if (value === this.scope?.value)
            return;
        this.epoch++;
        this.scope = value ? { value, owner, epoch: this.epoch } : null;
    }
    private serial<T>(operation: () => Promise<T>): Promise<T> {
        const task = this.queue.then(operation, operation);
        this.queue = task.catch(() => undefined);
        return task;
    }
    private allowed(key: string, owner: string) {
        // Finances, roles, quotas, raw credentials and unknown payloads remain memory-only.
        if (key.startsWith('snapshot.'))
            return /^snapshot\.\/v1\/(student\/(timetable|gpa|store(?:\/[^/?]+)?|tutorials)|learning\/courses|calendar(?:\/exam-periods)?|exams|messages\/(inbox|threads\/[a-f0-9-]+))(?:\?|$)/i.test(key);
        return key.includes(owner) && /^(profile\.|settings\.|home\.|timetable-draft\.|exam-draft\.|kira-draft\.|ai-draft\.|ai-workspace-v3\.|publishing-draft\.|publisher-draft\.|listing-draft\.|campus-activity-draft\.|answer-draft\.|message-draft\.|cart\.|search-recents\.|onboarding\.|calendar-editor-draft\.|business-profile-draft\.|calendar-local\.|telemetry\.)/.test(key);
    }
    private scopeValue(scope: {
        value: string;
        owner: string;
    }, key: string) {
        if (ownedRecordKey(key)) {
            try {
                const parsed = JSON.parse(scope.value);
                if (Array.isArray(parsed) && parsed[0] === scope.owner && (parsed[1] === null || typeof parsed[1] === 'string'))
                    return JSON.stringify(['owned.v1', scope.owner, parsed[1]]);
            }
            catch { /* Legacy/test scopes stay fully isolated. */ }
        }
        return scope.value;
    }
    async read<T>(key: string, options: { requireIntegrity?: boolean } = {}): Promise<RecordValue<T> | null> {
        const scope = this.scope;
        if (!scope || !this.allowed(key, scope.owner))
            return null;
        await this.queue;
        const scopeId = await this.io.hash(this.scopeValue(scope, key)), id = await this.io.hash(key);
        if (this.scope !== scope)
            return null;
        const location = prefix + scopeId + '.' + id;
        const raw = await this.io.get(location);
        if (this.scope !== scope || raw === null)
            return null;
        try {
            if (!raw || raw.length > maxRecord * 2)
                throw new SnapshotReadError();
            const envelope = JSON.parse(raw) as {
                v: number;
                sealed: string;
            };
            if (envelope.v !== 1 || typeof envelope.sealed !== 'string')
                throw new SnapshotReadError();
            const text = await this.io.open(scopeId, envelope.sealed, location);
            if (this.scope !== scope)
                return null;
            if (!text)
                throw new SnapshotReadError();
            const record = JSON.parse(text) as RecordValue<T>;
            if (record.version !== 1 || !Number.isFinite(record.savedAt) || !Number.isFinite(record.expires) || !Object.prototype.hasOwnProperty.call(record, 'data'))
                throw new SnapshotReadError();
            if (record.expires <= this.now()) {
                if (options.requireIntegrity && ownedRecordKey(key) && record.data !== null)
                    throw new SnapshotReadError();
                return null;
            }
            return record;
        }
        catch {
            if (options.requireIntegrity)
                throw new SnapshotReadError();
            return null;
        } // Integrity failures never become partially decoded data.
    }
    write(key: string, data: unknown, ttl: number): Promise<void> {
        const scope = this.scope;
        if (!scope || !this.allowed(key, scope.owner) || !Number.isFinite(ttl) || ttl <= 0)
            return Promise.resolve();
        return this.serial(async () => {
            if (this.scope !== scope)
                return;
            const scopeId = await this.io.hash(this.scopeValue(scope, key)), id = await this.io.hash(key);
            const location = prefix + scopeId + '.' + id;
            const keep = protectedDraft(key, data);
            const text = JSON.stringify({ version: 1, data, savedAt: this.now(), expires: this.now() + ttl, protectedDraft: keep });
            if (new TextEncoder().encode(text).byteLength > maxRecord || this.scope !== scope)
                return;
            const sealed = await this.io.seal(scopeId, text, location);
            if (this.scope !== scope)
                return;
            const raw = JSON.stringify({ v: 1, sealed });
            const storedKeys = await this.io.keys();
            if (this.scope !== scope)
                return;
            const scopeKey = prefix + 'scopes';
            let scopes: string[] = [];
            try {
                const parsed = JSON.parse(await this.io.get(scopeKey) ?? '[]');
                if (Array.isArray(parsed))
                    scopes = parsed.filter((value): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value));
            }
            catch { /* Reconstruct the bounded scope directory. */ }
            scopes = [...new Set([...scopes, ...storedKeys.map(key => key.startsWith(prefix) ? key.slice(prefix.length).split('.')[0]! : '')])].filter(value => /^[0-9a-f]{64}$/.test(value));
            scopes = scopes.filter(value => value !== scopeId);
            scopes.push(scopeId);
            while (scopes.length > 4) {
                let position = -1;
                for (let i = 0; i < scopes.length - 1; i++) {
                    const candidate = scopes[i]!;
                    if (!storedKeys.some(key => key.startsWith(prefix + candidate + '.'))) {
                        position = i;
                        break;
                    }
                    try {
                        const entries = JSON.parse(await this.io.get(prefix + candidate + '.index') ?? 'null');
                        if (Array.isArray(entries) && entries.every(entry => entry.keep === false || Number.isFinite(entry.expires) && entry.expires <= this.now())) {
                            position = i;
                            break;
                        }
                    }
                    catch { /* Never evict unknown draft storage on behalf of a snapshot. */ }
                }
                if (position < 0 || this.scope !== scope)
                    return;
                const [evicted] = scopes.splice(position, 1);
                await this.io.destroyKey(evicted!);
                for (const key of await this.io.keys())
                    if (key.startsWith(prefix + evicted + '.'))
                        await this.io.remove(key);
            }
            if (this.scope !== scope)
                return;
            await this.io.set(scopeKey, JSON.stringify(scopes));
            const indexKey = prefix + scopeId + '.index';
            let index: {
                key: string;
                bytes: number;
                at: number;
                keep?: boolean;
                expires?: number;
            }[] = [];
            let validIndex = false;
            const existing = storedKeys.filter(key => key.startsWith(prefix + scopeId + '.') && key !== indexKey);
            try {
                const savedIndex = await this.io.get(indexKey);
                const parsed = JSON.parse(savedIndex ?? '[]');
                validIndex = savedIndex !== null && Array.isArray(parsed) && parsed.length === existing.length && new Set(parsed.map(r => r?.key)).size === parsed.length && parsed.every(r => r && existing.includes(r.key) && Number.isFinite(r.bytes) && r.bytes > 0 && Number.isFinite(r.at) && r.at >= 0);
                if (validIndex)
                    index = parsed;
            }
            catch { /* Recover an incomplete index. */ }
            if (!validIndex) {
                for (const key of existing) {
                    const value = await this.io.get(key);
                    if (!value)
                        continue;
                    const entry: {
                        key: string;
                        bytes: number;
                        at: number;
                        keep: boolean;
                        expires?: number;
                    } = { key, bytes: value.length * 2, at: 0, keep: true };
                    try {
                        const envelope = JSON.parse(value);
                        const plaintext = await this.io.open(scopeId, envelope.sealed, key);
                        if (plaintext) {
                            const saved = JSON.parse(plaintext);
                            if (typeof saved.protectedDraft === 'boolean')
                                entry.keep = saved.protectedDraft;
                            if (Number.isFinite(saved.expires))
                                entry.expires = saved.expires;
                        }
                    }
                    catch { /* Keep unknown private data conservatively. */ }
                    index.push(entry);
                }
            }
            if (this.scope !== scope)
                return;
            for (const entry of index)
                if (Number.isFinite(entry.expires) && entry.expires! <= this.now())
                    await this.io.remove(entry.key);
            index = index.filter(entry => !Number.isFinite(entry.expires) || entry.expires! > this.now());
            index = index.filter(r => r.key !== location).sort((a, b) => a.at - b.at);
            let bytes = index.reduce((sum, r) => sum + r.bytes, 0) + raw.length * 2;
            while (index.length && (bytes > maxBytes || index.length >= maxRecords)) {
                const evict = index.findIndex(entry => !entry.keep);
                if (evict < 0)
                    return; // Never silently evict an unexpired pending draft to save a display snapshot.
                const [oldest] = index.splice(evict, 1);
                bytes -= oldest!.bytes;
                await this.io.remove(oldest!.key);
            }
            if (this.scope !== scope)
                return;
            await this.io.set(location, raw);
            index.push({ key: location, bytes: raw.length * 2, at: this.now(), keep, expires: this.now() + ttl });
            await this.io.set(indexKey, JSON.stringify(index));
        });
    }
    remove(key: string): Promise<void> {
        const scope = this.scope;
        if (!scope)
            return Promise.resolve();
        return this.serial(async () => { const id = await this.io.hash(this.scopeValue(scope, key)), record = await this.io.hash(key); if (this.scope === scope)
            await this.io.remove(prefix + id + '.' + record); });
    }
    /** Clear scope synchronously before awaiting native storage; late writes cannot resurrect it. */
    clear(): Promise<void> {
        const previous = this.scope;
        this.activate(null);
        return this.serial(async () => {
            const keys = (await this.io.keys()).filter(key => key.startsWith(prefix));
            const keyIds = new Set(keys.map(key => key.slice(prefix.length).split('.')[0]!).filter(key => /^[0-9a-f]{64}$/.test(key)));
            if (previous) {
                keyIds.add(await this.io.hash(previous.value));
                keyIds.add(await this.io.hash(this.scopeValue(previous, 'calendar-local.' + previous.owner)));
            }
            // Destroying keys first makes remaining ciphertext unreadable even if removal fails.
            for (const keyId of keyIds)
                await this.io.destroyKey(keyId);
            for (const key of keys)
                await this.io.remove(key);
        });
    }
}
