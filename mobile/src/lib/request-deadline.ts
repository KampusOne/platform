import { waitForRequest } from "./request-policy";

/** React Native's AbortSignal has no static timeout(); use its supported controller. */
export async function withRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 15_000,
  parentSignal?: AbortSignal | null,
): Promise<T> {
  const controller = new AbortController();
  let reason: unknown;
  const cancel = () => {
    reason = parentSignal?.reason ?? new Error("Request cancelled");
    controller.abort();
  };
  const timer = setTimeout(() => {
    const error = new Error("The request took too long. Check your connection and try again.");
    error.name = "TimeoutError";
    reason = error;
    controller.abort();
  }, timeoutMs);
  parentSignal?.addEventListener("abort", cancel, { once: true });
  try {
    if (parentSignal?.aborted) { cancel(); throw reason; }
    // Race the promise too: native fetch/body readers do not always settle on abort.
    return await waitForRequest(operation(controller.signal), controller.signal);
  } catch (caught) {
    throw controller.signal.aborted ? reason ?? caught : caught;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", cancel);
  }
}
