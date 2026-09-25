const mediaFields = new Set([
  "url", "image_url", "media_url", "file_url", "document_url", "avatar_url",
  "source_image_url", "author_image_url", "profile_image_url", "cover_image_url", "imageUrl", "mediaUrl", "profileImageUrl", "coverImageUrl",
]);
const mediaPath = /^\/(?:api\/)?v1\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
/** Resolve internal media links without forcing public bytes through the web API rewrite.
 * Public absolute Worker URLs can render directly in browsers and preserve byte-range
 * requests for video. Signed/private links stay same-origin on web so their access
 * query and authorization boundary are unchanged. Native clients keep using apiBase.
 */
export function resolveMediaLink(value: string, apiBase: string): string {
  try {
    const url = new URL(value, "https://media.invalid");
    if (!["http:", "https:"].includes(url.protocol)) return value;
    const match = mediaPath.exec(url.pathname);
    if (!match) return value;
    url.searchParams.set("v", "3");
    const webProxy = apiBase.startsWith("/");
    const absoluteStoredUrl = url.origin !== "https://media.invalid";
    if (webProxy && absoluteStoredUrl && !url.searchParams.has("access"))
      return url.toString();
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
