import { ApiError, type ApiRequestInit } from './api-transport';

type Stage = 'reading' | 'analysing' | 'finishing';
type Transport = <T>(path: string, init: ApiRequestInit) => Promise<T>;

/** The result receipt can arrive even when the original HTTP response is lost.
 * Only the initial POST is metered; every recovery read checks that same key. */
export async function submitTrackedAIRequest<T>(transport: Transport, init: ApiRequestInit,
  onProgress: (stage: Stage) => void): Promise<T> {
  let id = '';
  try { id = JSON.parse(String(init.body)).idempotencyKey ?? ''; } catch { /* The API validates the submission. */ }
  if (!/^[a-f0-9-]{36}$/i.test(id)) return transport<T>('/v1/ai', init);
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason ?? new Error('Reading stopped. Your file and draft are kept.'));
  if (init.signal?.aborted) abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  let originalFailure: unknown;
  let missingReads = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = Date.now() + (init.timeoutMs ?? 180000) + 15000;
  const wait = (ms: number) => new Promise<void>((resolve, reject) => {
    const cancelled = () => { if (timer) clearTimeout(timer); reject(controller.signal.reason); };
    if (controller.signal.aborted) { cancelled(); return; }
    controller.signal.addEventListener('abort', cancelled, { once: true });
    timer = setTimeout(() => { controller.signal.removeEventListener('abort', cancelled); resolve(); }, ms);
  });
  const submission = transport<T>('/v1/ai', { ...init, signal: controller.signal }).catch(error => {
    const recoverable = error instanceof ApiError && (
      ['NETWORK_ERROR', 'NETWORK_UNAVAILABLE', 'REQUEST_TIMEOUT'].includes(error.code)
      || (error.status === 409 && error.details?.reason === 'AI_PROCESSING')
      || (error.details?.reason === 'AI_SAVE_FAILED' && error.details?.retryWithNewKey === false)
      || (error.status >= 502 && !error.details?.reason));
    if (!recoverable || controller.signal.aborted) throw error;
    originalFailure = error;
    // Leave completion to the same-key receipt reader, without another POST.
    return new Promise<T>(() => undefined);
  });
  const receipt = (async (): Promise<T> => {
    await wait(1000);
    while (!controller.signal.aborted && Date.now() < deadline) {
      try {
        const result = await transport<{ status: string; requestId: string; stage?: Stage }>(
          '/v1/ai/requests/' + id, { cache: 'no-store', timeoutMs: 8000, signal: controller.signal });
        missingReads = 0;
        if (result.requestId !== id) throw new Error('The AI receipt did not match this document. Your draft is kept.');
        if (result.status === 'completed') return result as T;
        if (['reading', 'analysing', 'finishing'].includes(result.stage ?? '')) onProgress(result.stage!);
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (error instanceof ApiError) {
          if (error.details?.retryWithNewKey === true || [401, 403, 410].includes(error.status)) throw error;
          if (error.status === 404 && originalFailure && ++missingReads >= 3) throw originalFailure;
          if (error.status === 409 && error.details?.reason !== 'AI_PROCESSING') throw error;
        } else throw error;
      }
      await wait(2500);
    }
    if (controller.signal.aborted) throw controller.signal.reason;
    throw originalFailure ?? new ApiError(504, 'REQUEST_TIMEOUT', 'Reading is still processing. Your file is kept; retry checks the same attempt.');
  })();
  try { return await Promise.race([submission, receipt]); }
  finally {
    controller.abort();
    if (timer) clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  }
}
