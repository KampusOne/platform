import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  storage: new Map<string, string>(), size: 12, reads: [] as { offset: number; length: number }[], closes: vi.fn(),
  session: { id: 'session', status: 'OPEN', mediaId: null as string | null, chunkBytes: 5, parts: {} as Record<string, { size: number }> },
  api: vi.fn(), os: 'android',
}));
vi.mock('../../mobile/node_modules/react-native/index.js', () => ({ Platform: { get OS() { return mock.os; } } }));
vi.mock('../../mobile/node_modules/@react-native-async-storage/async-storage/lib/commonjs/index.js', () => ({ default: {
  getItem: async (key: string) => mock.storage.get(key) ?? null,
  setItem: async (key: string, value: string) => { mock.storage.set(key, value); },
  removeItem: async (key: string) => { mock.storage.delete(key); },
} }));
vi.mock('../../mobile/node_modules/expo-crypto/build/Crypto.js', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: async (_: string, text: string) => text, randomUUID: () => 'upload-id' }));
vi.mock('../../mobile/node_modules/expo-file-system/src/index.ts', () => ({
  FileMode: { ReadOnly: 'r' },
  File: class {
    get size() { return mock.size; }
    slice() { throw new Error('Whole-file allocation is forbidden'); }
    bytesSync() { throw new Error('Whole-file allocation is forbidden'); }
    open() { return { offset: 0, readBytes(length: number) { mock.reads.push({ offset: this.offset, length }); return new Uint8Array(length); }, close: mock.closes }; }
  },
}));
vi.mock('../../mobile/src/lib/request-deadline',()=>({withRequestDeadline:(operation:(signal:AbortSignal)=>Promise<unknown>)=>operation(new AbortController().signal)}));
vi.mock('../../mobile/src/lib/api', () => ({ api: mock.api }));
import { uploadMessageFile } from '../../mobile/src/lib/message-upload';
const file = { localId: 'draft-1', uri: 'file:///cache/image', name: 'photo.jpg', mimeType: 'image/jpeg' };
beforeEach(() => {
  mock.storage.clear(); mock.reads = []; mock.size = 12; mock.closes.mockClear(); mock.os = 'android';
  mock.session = { id: 'session', status: 'OPEN', mediaId: null, chunkBytes: 5, parts: {} }; mock.api.mockReset();
  mock.api.mockImplementation(async (path: string) => path.endsWith('/complete') ? { id: 'media-1' } : path === '/v1/media/message-uploads' ? mock.session : {});
});
describe('bounded native message uploads', () => {
  it('reads only each chunk using a native file handle and closes it', async () => {
    const progress = vi.fn(); expect(await uploadMessageFile('student', file, progress)).toBe('media-1');
    expect(mock.reads).toEqual([{ offset: 0, length: 5 }, { offset: 5, length: 5 }, { offset: 10, length: 2 }]);
    expect(mock.closes).toHaveBeenCalledOnce(); expect(progress).toHaveBeenLastCalledWith(1); expect(mock.storage.size).toBe(0);
  });
  it('skips complete chunks and seeks to remaining bytes', async () => {
    mock.session.parts = { '1': { size: 5 }, '2': { size: 5 } }; await uploadMessageFile('student', file, vi.fn());
    expect(mock.reads).toEqual([{ offset: 10, length: 2 }]);
    expect(mock.api.mock.calls.some(([path]) => String(path).endsWith('/parts/1'))).toBe(false);
  });
  it('closes the native file on failure and retains a retry id', async () => {
    mock.api.mockImplementation(async (path: string) => { if (path.includes('/parts/')) throw new Error('Network unavailable'); return mock.session; });
    await expect(uploadMessageFile('student', file, vi.fn())).rejects.toThrow('Network unavailable');
    expect(mock.closes).toHaveBeenCalledOnce(); expect(mock.reads).toHaveLength(1); expect(mock.storage.size).toBe(1);
  });
  it('keeps the upload id when restoring a draft out of cache', async () => {
    mock.api.mockImplementation(async (path: string) => { if (path.includes('/parts/')) throw new Error('Network unavailable'); return mock.session; });
    await expect(uploadMessageFile('student', file, vi.fn())).rejects.toThrow();
    await expect(uploadMessageFile('student', { ...file, uri: 'file:///documents/draft' }, vi.fn())).rejects.toThrow();
    expect(mock.storage.size).toBe(1);
  });
});

it('sends direct chunks to R2 and confirms them with the API without proxying bytes',async()=>{
 Object.assign(mock.session,{transport:'direct'});
 const fetch=vi.fn(async()=>new Response('',{status:200}));vi.stubGlobal('fetch',fetch);
 mock.api.mockImplementation(async(path:string)=>path.endsWith('/complete')?{id:'media-1'}:path==='/v1/media/message-uploads'?mock.session:path.endsWith('/url')?{url:'https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com/kampusone-private/reserved?X-Amz-Signature=fixture',headers:{'Content-Type':'application/octet-stream'}}:{});
 try{
  expect(await uploadMessageFile('student',file,vi.fn())).toBe('media-1');
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(mock.api.mock.calls.filter(([,opts])=>opts?.method==='PUT')).toHaveLength(0);
  expect(mock.api.mock.calls.filter(([path])=>String(path).endsWith('/confirm'))).toHaveLength(3);
  expect(mock.reads.every(r=>r.length<=5)).toBe(true);
 }finally{vi.unstubAllGlobals();}
});
