import { api as transport, currentApiUrl, peekTransportCache, type ApiRequestInit } from "./api-transport";
import { normalizeMediaLinks } from "./media-links";
import { normalizeServerDates } from './server-date';
import { submitTrackedAIRequest } from './ai-request';

export * from "./api-transport";
const normalized = new WeakMap<object, { origin: string; value: unknown }>();
function normalize<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  const origin = currentApiUrl();
  const saved = normalized.get(value);
  if (saved?.origin === origin) return saved.value as T;
  const result = normalizeServerDates(normalizeMediaLinks(value, origin));
  normalized.set(value, { origin, value: result });
  return result;
}
export async function api<T>(path: string, init: ApiRequestInit & {onAIProgress?:(stage:'reading'|'analysing'|'finishing')=>void} = {}, canRefresh = true): Promise<T> {
  const {onAIProgress,...request}=init;
  if (path === '/v1/ai' && request.method === 'POST' && onAIProgress) {
    return normalize(await submitTrackedAIRequest<T>((url, options) => transport(url, options, canRefresh), request, onAIProgress));
  }
  return normalize(await transport<T>(path, request, canRefresh));
}
export function peekApiCache<T>(path: string, options: { allowStale?: boolean } = {}): T | undefined {
  const saved = peekTransportCache<T>(path, options);
  return saved === undefined ? undefined : normalize(saved);
}
