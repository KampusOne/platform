import { AIProviderError } from './ai-error.ts';
import type { WorkersAIBinding } from './ai-workers';

/** Private bytes only; never ask the converter to fetch a client URL. */
export async function convertAIFile(ai: WorkersAIBinding | undefined, bytes: Uint8Array, name: string, mime: string, timeoutMs = 45000): Promise<string> {
  if (typeof ai?.toMarkdown !== 'function') throw new AIProviderError(503, 'AI_DOCUMENT_READER_UNAVAILABLE', 'Document reading is temporarily unavailable. Your file is kept.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const data = new Uint8Array(bytes.byteLength); data.set(bytes);
    const result = await Promise.race([
      ai.toMarkdown([{ name, blob: new Blob([data.buffer], { type: mime }) }]),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AIProviderError(504, 'AI_TIMEOUT', 'Reading took too long. Your file is kept; try a smaller section.')), Math.max(1, timeoutMs)); }),
    ]);
    const file = result[0];
    const text = typeof file?.data === 'string' ? file.data.trim() : '';
    if (file?.format === 'error' || !text) throw new AIProviderError(422, 'AI_UNREADABLE_DOCUMENT', 'The file has no readable content. Upload a clearer scan or another export.');
    if (text.length > 45000) throw new AIProviderError(422, 'AI_DOCUMENT_TOO_LONG', 'This document contains too much material for one request. Upload a smaller section.');
    return text;
  } catch (error) {
    if (error instanceof AIProviderError) throw error;
    throw new AIProviderError(503, 'AI_DOCUMENT_READER_UNAVAILABLE', 'Document reading could not connect. Your file is kept; try again.');
  } finally { if (timer) clearTimeout(timer); }
}
