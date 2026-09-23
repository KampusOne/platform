import { api as transport, apiUrl } from "./api-transport";
import { normalizeMediaLinks } from "./media-links";

// Keep authentication, refresh locking and caching in the unchanged transport.
// All consumers receive media URLs for their own web proxy or native API origin.
export * from "./api-transport";
export async function api<T>(path: string, init: RequestInit = {}, canRefresh = true): Promise<T> {
  return normalizeMediaLinks(await transport<T>(path, init, canRefresh), apiUrl);
}
