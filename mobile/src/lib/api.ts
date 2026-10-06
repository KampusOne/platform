import { api as transport, currentApiUrl, peekTransportCache, type ApiRequestInit } from "./api-transport";
import { normalizeMediaLinks } from "./media-links";

export * from "./api-transport";
const normalized = new WeakMap<object, { origin: string; value: unknown }>();
function normalize<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  const origin = currentApiUrl();
  const saved = normalized.get(value);
  if (saved?.origin === origin) return saved.value as T;
  const result = normalizeMediaLinks(value, origin);
  normalized.set(value, { origin, value: result });
  return result;
}
export async function api<T>(path: string, init: ApiRequestInit = {}, canRefresh = true): Promise<T> {
  return normalize(await transport<T>(path, init, canRefresh));
}
export function peekApiCache<T>(path: string): T | undefined {
  const saved = peekTransportCache<T>(path);
  return saved === undefined ? undefined : normalize(saved);
}
