export const FAST_VIDEO_BUFFER_OPTIONS = {
  minBufferForPlayback: 0.35,
  preferredForwardBufferDuration: 3,
  prioritizeTimeOverSizeThreshold: true,
};

export function cachedVideoSource(uri: string) {
  return { uri, useCaching: true };
}

/** Both current media arrays and older feed rows can contain a video. */
export function postVideoSource(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const post = value as Record<string, unknown>;
  const playableUrl = (url: unknown) => typeof url === 'string' && /^(https?:\/\/|\/(?:api\/)?v1\/media\/)/i.test(url.trim()) ? url.trim() : '';
  if (Array.isArray(post.media)) {
    for (const entry of post.media) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.type !== 'string' || !item.type.toLowerCase().startsWith('video/')) continue;
      const url = playableUrl(item.url);
      if (url) return url;
    }
  }
  const type = typeof post.media_type === 'string' ? post.media_type.toLowerCase() : '';
  return type === 'video' || type.startsWith('video/') ? playableUrl(post.image_url) : '';
}

export function safeVideoRouteUrl(
  value: string | string[] | undefined,
): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}
