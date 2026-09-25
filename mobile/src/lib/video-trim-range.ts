export const MAX_POST_VIDEO_DURATION_MS = 90_000;
export const MIN_POST_VIDEO_DURATION_MS = 1_000;

export type VideoTrimRange = { startMs: number; endMs: number };

export const clampVideoTime = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export function initialVideoTrimRange(
  durationMs: number,
  maxDurationMs = MAX_POST_VIDEO_DURATION_MS,
): VideoTrimRange {
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error("This video has an invalid duration. Choose another video.");
  return { startMs: 0, endMs: Math.min(durationMs, maxDurationMs) };
}

export function setVideoTrimStart(
  range: VideoTrimRange,
  nextStartMs: number,
  durationMs: number,
  maxDurationMs = MAX_POST_VIDEO_DURATION_MS,
  minDurationMs = MIN_POST_VIDEO_DURATION_MS,
): VideoTrimRange {
  const minimum = Math.min(minDurationMs, durationMs);
  const endMs = clampVideoTime(range.endMs, minimum, durationMs);
  const lowerBound = Math.max(0, endMs - maxDurationMs);
  const startMs = clampVideoTime(nextStartMs, lowerBound, Math.max(lowerBound, endMs - minimum));
  return { startMs, endMs };
}

export function setVideoTrimEnd(
  range: VideoTrimRange,
  nextEndMs: number,
  durationMs: number,
  maxDurationMs = MAX_POST_VIDEO_DURATION_MS,
  minDurationMs = MIN_POST_VIDEO_DURATION_MS,
): VideoTrimRange {
  const minimum = Math.min(minDurationMs, durationMs);
  const startMs = clampVideoTime(range.startMs, 0, Math.max(0, durationMs - minimum));
  const upperBound = Math.min(durationMs, startMs + maxDurationMs);
  const endMs = clampVideoTime(nextEndMs, Math.min(upperBound, startMs + minimum), upperBound);
  return { startMs, endMs };
}

export function formatVideoTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}
