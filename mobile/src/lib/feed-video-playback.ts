export type FeedVideoFrame = {
  id: string;
  y: number;
  height: number;
};

export function pickFullyVisibleVideo(
  frames: FeedVideoFrame[],
  viewportTop: number,
  viewportBottom: number,
  tolerance = 1,
) {
  if (!Number.isFinite(viewportTop) || !Number.isFinite(viewportBottom) || viewportBottom <= viewportTop) {
    return null;
  }

  const viewportCenter = (viewportTop + viewportBottom) / 2;
  let selected: { id: string; distance: number } | null = null;

  for (const frame of frames) {
    if (!frame.id || !Number.isFinite(frame.y) || !Number.isFinite(frame.height) || frame.height <= 0) continue;
    const bottom = frame.y + frame.height;
    const fullyVisible =
      frame.y >= viewportTop - tolerance &&
      bottom <= viewportBottom + tolerance;
    if (!fullyVisible) continue;

    const distance = Math.abs(frame.y + frame.height / 2 - viewportCenter);
    if (!selected || distance < selected.distance) selected = { id: frame.id, distance };
  }

  return selected?.id ?? null;
}
export type FeedVideoFrame = {
  id: string;
  y: number;
  height: number;
};

export function pickFullyVisibleVideo(
  frames: FeedVideoFrame[],
  viewportTop: number,
  viewportBottom: number,
  tolerance = 1,
) {
  if (!Number.isFinite(viewportTop) || !Number.isFinite(viewportBottom) || viewportBottom <= viewportTop) {
    return null;
  }

  const viewportCenter = (viewportTop + viewportBottom) / 2;
  let selected: { id: string; distance: number } | null = null;

  for (const frame of frames) {
    if (!frame.id || !Number.isFinite(frame.y) || !Number.isFinite(frame.height) || frame.height <= 0) continue;
    const bottom = frame.y + frame.height;
    const fullyVisible =
      frame.y >= viewportTop - tolerance &&
      bottom <= viewportBottom + tolerance;
    if (!fullyVisible) continue;

    const distance = Math.abs(frame.y + frame.height / 2 - viewportCenter);
    if (!selected || distance < selected.distance) selected = { id: frame.id, distance };
  }

  return selected?.id ?? null;
}


type FeedRoutePlaybackListener = (active: boolean) => void;

let feedRoutePlaybackActive = false;
const feedRoutePlaybackListeners = new Set<FeedRoutePlaybackListener>();

export function isFeedRoutePath(pathname: string): boolean {
  const normalized = pathname.split("?")[0]?.replace(/\/+$/, "") || "/";
  return normalized === "/feed" || normalized === "feed" || normalized.endsWith("/feed");
}

export function isFeedRoutePlaybackActive(): boolean {
  return feedRoutePlaybackActive;
}

export function setFeedRoutePlaybackActive(active: boolean): void {
  feedRoutePlaybackActive = active;
  for (const listener of feedRoutePlaybackListeners) listener(active);
}

export function subscribeFeedRoutePlayback(listener: FeedRoutePlaybackListener): () => void {
  feedRoutePlaybackListeners.add(listener);
  listener(feedRoutePlaybackActive);
  return () => feedRoutePlaybackListeners.delete(listener);
}
