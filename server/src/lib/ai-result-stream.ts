import { AppError } from './errors';

export const aiResultStreamType = 'application/vnd.kampusone.ai-result+json';

/** Whitespace is valid before JSON. Sending it while inference runs keeps the
 * HTTP invocation and its proxy connection active; waitUntil alone only gives
 * a disconnected Worker another 30 seconds. The final payload is still one
 * JSON document, so native and browser clients can use response.json(). */
export function aiResultStream(job: Promise<unknown>, requestId: string) {
  const encoder = new TextEncoder();
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { finished = true; if (timer !== undefined) clearTimeout(timer); };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const keepAlive = () => {
        if (finished) return;
        try { controller.enqueue(encoder.encode(' '.repeat(2048) + '\n')); }
        catch { stop(); return; }
        timer = setTimeout(keepAlive, 5000);
      };
      const finish = (payload: unknown) => {
        if (finished) return;
        stop();
        try { controller.enqueue(encoder.encode(JSON.stringify(payload))); controller.close(); }
        catch { /* A disconnected reader does not change the saved receipt. */ }
      };
      keepAlive();
      void job.then(finish, error => {
        const failure = error instanceof AppError ? error
          : new AppError(503, 'PROVIDER_UNAVAILABLE', 'This attempt could not finish. Your file is kept; retry to check the same attempt.', {reason:'AI_SAVE_FAILED',retryWithNewKey:false});
        finish({requestId,status:'failed',httpStatus:failure.status,error:{code:failure.code,message:failure.message,details:failure.details}});
      });
    },
    cancel() { stop(); },
  });
}
