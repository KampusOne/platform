export const FAST_VIDEO_BUFFER_OPTIONS = {
  minBufferForPlayback: 0.35,
  preferredForwardBufferDuration: 3,
  prioritizeTimeOverSizeThreshold: true,
};

export function cachedVideoSource(uri: string) {
  return { uri, useCaching: true };
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
