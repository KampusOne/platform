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
