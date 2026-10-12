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
type RecordValue<T> = { version: 1; data: T; expires: number; savedAt: number };
/** Atomic single-key payloads; writes/deletions are serialized, not a parallel JSON read-modify-write. */
export class SecureSnapshots {
  private scope: { value: string; owner: string; epoch: number } | null = null;
  private epoch = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private io: SnapshotIO, private now = Date.now) {}
  activate(value: string | null, owner = '') {
    if (value === this.scope?.value) return;
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
    if (key.startsWith('snapshot.')) return /^snapshot\.\/v1\/(student\/(timetable|gpa|store(?:\/[^/?]+)?|tutorials)|learning\/courses|calendar(?:\/exam-periods)?|exams|messages\/(inbox|threads\/[a-f0-9-]+))(?:\?|$)/i.test(key);
    return key.includes(owner) && /^(profile\.|settings\.|home\.|timetable-draft\.|exam-draft\.|kira-draft\.|ai-draft\.|ai-workspace-v3\.|publishing-draft\.|publisher-draft\.|listing-draft\.|answer-draft\.|message-draft\.|cart\.|search-recents\.|onboarding\.|calendar-local\.)/.test(key);
  }
  async read<T>(key: string): Promise<RecordValue<T> | null> {
    const scope = this.scope;
    if (!scope || !this.allowed(key, scope.owner)) return null;
    await this.queue;
    const scopeId = await this.io.hash(scope.value), id = await this.io.hash(key);
    if (this.scope !== scope) return null;
    const location = prefix + scopeId + '.' + id;
    const raw = await this.io.get(location);
    if (!raw || raw.length > maxRecord * 2 || this.scope !== scope) return null;
    try {
      const envelope = JSON.parse(raw) as { v: number; sealed: string };
      if (envelope.v !== 1 || typeof envelope.sealed !== 'string') return null;
      const text = await this.io.open(scopeId, envelope.sealed, location);
      if (!text || this.scope !== scope) return null;
      const record = JSON.parse(text) as RecordValue<T>;
      if (record.version !== 1 || !Number.isFinite(record.savedAt) || !Number.isFinite(record.expires) || record.expires <= this.now()) return null;
      return record;
    } catch { return null; } // Integrity failures never become partially decoded data.
  }
  write(key: string, data: unknown, ttl: number): Promise<void> {
    const scope = this.scope;
    if (!scope || !this.allowed(key, scope.owner) || !Number.isFinite(ttl) || ttl<=0) return Promise.resolve();
    return this.serial(async () => {
      if (this.scope !== scope) return;
      const scopeId = await this.io.hash(scope.value), id = await this.io.hash(key);
      const location = prefix + scopeId + '.' + id;
      const text = JSON.stringify({ version: 1, data, savedAt: this.now(), expires: this.now() + ttl });
      if (new TextEncoder().encode(text).byteLength > maxRecord || this.scope !== scope) return;
      const sealed = await this.io.seal(scopeId, text, location);
      if (this.scope !== scope) return;
      const raw = JSON.stringify({ v: 1, sealed });
      const storedKeys=await this.io.keys();
      const scopeKey=prefix+'scopes';
      let scopes:string[]=[];
      try{const parsed=JSON.parse(await this.io.get(scopeKey)??'[]');if(Array.isArray(parsed))scopes=parsed.filter((value):value is string=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value));}catch{/* Reconstruct the bounded scope directory. */}
      scopes=[...new Set([...scopes,...storedKeys.map(key=>key.startsWith(prefix)?key.slice(prefix.length).split('.')[0]!:'')])].filter(value=>/^[0-9a-f]{64}$/.test(value));
      scopes=scopes.filter(value=>value!==scopeId);scopes.push(scopeId);
      while(scopes.length>4){const evicted=scopes.shift()!;await this.io.destroyKey(evicted);for(const key of await this.io.keys())if(key.startsWith(prefix+evicted+'.'))await this.io.remove(key);}
      await this.io.set(scopeKey,JSON.stringify(scopes));
      const indexKey = prefix + scopeId + '.index';
      let index: { key: string; bytes: number; at: number }[] = [];
      let validIndex=false;
      const existing=storedKeys.filter(key=>key.startsWith(prefix+scopeId+'.')&&key!==indexKey);
      try { const savedIndex=await this.io.get(indexKey);const parsed = JSON.parse(savedIndex ?? '[]');validIndex=savedIndex!==null&&Array.isArray(parsed)&&parsed.length===existing.length&&new Set(parsed.map(r=>r?.key)).size===parsed.length&&parsed.every(r=>r&&existing.includes(r.key)&&Number.isFinite(r.bytes)&&r.bytes>0&&Number.isFinite(r.at)&&r.at>=0);if(validIndex)index=parsed; } catch { /* Recover an incomplete index. */ }
      if(!validIndex){for(const key of existing){const value=await this.io.get(key);if(value)index.push({key,bytes:value.length*2,at:0});}}
      index = index.filter(r => r.key !== location).sort((a,b) => a.at - b.at);
      let bytes = index.reduce((sum,r) => sum + r.bytes, 0) + raw.length * 2;
      while (index.length && (bytes > maxBytes || index.length >= maxRecords)) {
        const oldest = index.shift()!; bytes -= oldest.bytes; await this.io.remove(oldest.key);
      }
      if (this.scope !== scope) return;
      await this.io.set(location, raw);
      index.push({ key: location, bytes: raw.length * 2, at: this.now() });
      await this.io.set(indexKey, JSON.stringify(index));
    });
  }
  remove(key:string):Promise<void>{
    const scope=this.scope;if(!scope)return Promise.resolve();
    return this.serial(async()=>{const id=await this.io.hash(scope.value),record=await this.io.hash(key);if(this.scope===scope)await this.io.remove(prefix+id+'.'+record);});
  }
  /** Clear scope synchronously before awaiting native storage; late writes cannot resurrect it. */
  clear(): Promise<void> {
    const previous = this.scope;
    this.activate(null);
    return this.serial(async () => {
      const keys = (await this.io.keys()).filter(key => key.startsWith(prefix));
      const keyIds = new Set(keys.map(key => key.slice(prefix.length).split('.')[0]!).filter(key=>/^[0-9a-f]{64}$/.test(key)));
      if (previous) keyIds.add(await this.io.hash(previous.value));
      // Destroying keys first makes remaining ciphertext unreadable even if removal fails.
      for (const keyId of keyIds) await this.io.destroyKey(keyId);
      for (const key of keys) await this.io.remove(key);
    });
  }
}
