import { api } from './api';
export type DocumentReadRequest = { id: number; mediaId:string; name: string; url: string; type: string; query: string; maxPages: number };
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
export async function readUploadedDocument(mediaId: string, name: string, type: string, query = '', tier = 'standard', signal?:AbortSignal) {
  if (current) throw new Error('Finish reading the current document first.');
  if (!listeners.size) throw new Error('The document reader is opening. Please retry in a moment.');
  const { url } = await api<{ url: string }>(`/v1/media/${mediaId}/access`, { method: 'POST',signal:signal??null });
  return new Promise<string>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => finishDocumentRead(id, undefined, 'Reading took too long. Your uploaded file is saved for retry.'), 480000);
    const abort=()=>finishDocumentRead(id,undefined,'Reading stopped. Your uploaded file is kept for retry.');
    if(signal?.aborted){clearTimeout(timer);reject(new Error('Reading stopped. Your uploaded file is kept.'));return;}
    resolveCurrent = value => { clearTimeout(timer);signal?.removeEventListener('abort',abort); resolve(value); };
    rejectCurrent = error => { clearTimeout(timer);signal?.removeEventListener('abort',abort); reject(error); };
    current = { id, mediaId, name, url, type, query, maxPages: tier === 'pro' ? 300 : 150 };
    signal?.addEventListener('abort',abort,{once:true});
    listeners.forEach(listener => listener());
  });
}

export async function transcribeDocumentPage(request: DocumentReadRequest, value: {page:number;image:string}) {
  if (current?.id !== request.id || !Number.isInteger(value.page) || value.page < 1 || value.page > request.maxPages ||
    typeof value.image !== 'string' || !/^data:image\/jpeg;base64,/.test(value.image) || value.image.length > 2_500_000) throw new Error('This scanned page could not be read.');
  const result = await api<{text:string}>('/v1/ai/document-pages', {method:'POST',timeoutMs:60_000,body:JSON.stringify({mediaId:request.mediaId,pageNumber:value.page,image:value.image})});
  return result.text;
}
