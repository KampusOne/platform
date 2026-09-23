import { api as transport, apiUrl, peekTransportCache } from "./api-transport";
import { normalizeMediaLinks } from "./media-links";

export * from "./api-transport";
const normalized = new WeakMap<object, unknown>();
function normalize<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (normalized.has(value)) return normalized.get(value) as T;
  const result = normalizeMediaLinks(value, apiUrl);
  normalized.set(value, result);
  return result;
}
export async function api<T>(path: string, init: RequestInit = {}, canRefresh = true): Promise<T> {
  return normalize(await transport<T>(path, init, canRefresh));
}
export function peekApiCache<T>(path: string): T | undefined {
  const saved = peekTransportCache<T>(path);
  return saved === undefined ? undefined : normalize(saved);
}
