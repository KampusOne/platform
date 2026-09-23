const mediaFields = new Set([
  "url", "image_url", "media_url", "file_url", "document_url", "avatar_url",
  "source_image_url", "author_image_url", "profile_image_url", "cover_image_url", "imageUrl", "mediaUrl", "profileImageUrl", "coverImageUrl",
]);
const mediaPath = /^\/(?:api\/)?v1\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
/** Resolve stored Worker URLs through the same API origin as this client.
 * The version also avoids reusing responses cached with the old CORP header.
 * Only exact internal media routes are changed; signed access parameters survive.
 */
export function resolveMediaLink(value: string, apiBase: string): string {
  try {
    const url = new URL(value, "https://media.invalid");
    if (!["http:", "https:"].includes(url.protocol)) return value;
    const match = mediaPath.exec(url.pathname);
    if (!match) return value;
    url.searchParams.set("v", "2");
    return `${apiBase.replace(/\/$/, "")}/v1/media/${match[1]}${url.search}`;
  } catch { return value; }
}
export function normalizeMediaLinks<T>(payload: T, apiBase: string): T {
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key, typeof child === "string" && mediaFields.has(key) ? resolveMediaLink(child, apiBase) : visit(child),
    ]));
  }
  return visit(payload) as T;
}
