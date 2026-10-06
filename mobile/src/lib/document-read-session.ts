import { api } from './api';
export type DocumentReadRequest = { id: number; name: string; url: string; type: string; query: string; maxPages: number };
let current: DocumentReadRequest | null = null;
let resolveCurrent: ((value: string) => void) | null = null, rejectCurrent: ((error: Error) => void) | null = null;
let sequence = 0;
const listeners = new Set<() => void>();
export const getDocumentRead = () => current;
export const getServerDocumentRead = () => null;
export const subscribeDocumentRead = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function finishDocumentRead(id: number, text?: string, error?: string) {
  if (current?.id !== id) return;
  const resolve = resolveCurrent, reject = rejectCurrent;
  current = null; resolveCurrent = null; rejectCurrent = null;
  listeners.forEach(listener => listener());
  if (typeof text === 'string' && text.trim() && text.length <= 50000) resolve?.(text);
  else reject?.(new Error(error || 'This document could not be read. Attach a clear page as an image or a text export.'));
}
export async function readUploadedDocument(mediaId: string, name: string, type: string, query = '', tier = 'standard') {
  if (current) throw new Error('Finish reading the current document first.');
  if (!listeners.size) throw new Error('The document reader is opening. Please retry in a moment.');
  const { url } = await api<{ url: string }>(`/v1/media/${mediaId}/access`, { method: 'POST' });
  return new Promise<string>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => finishDocumentRead(id, undefined, 'Reading took too long. Your uploaded file is saved; retry or attach a smaller section.'), 150000);
    resolveCurrent = value => { clearTimeout(timer); resolve(value); };
    rejectCurrent = error => { clearTimeout(timer); reject(error); };
    current = { id, name, url, type, query, maxPages: tier === 'pro' ? 300 : 150 };
    listeners.forEach(listener => listener());
  });
}
