export type VideoPlaybackSession = {
  position: number;
  muted: boolean;
  updatedAt: number;
};

const sessions = new Map<string, VideoPlaybackSession>();

export function readVideoPlaybackSession(key: string | undefined): VideoPlaybackSession | null {
  if (!key) return null;
  return sessions.get(key) ?? null;
}

export function writeVideoPlaybackSession(
  key: string | undefined,
  position: number,
  muted: boolean,
): void {
  if (!key || !Number.isFinite(position) || position < 0) return;
  sessions.set(key, {
    position,
    muted,
    updatedAt: Date.now(),
  });
}

export function clearVideoPlaybackSession(key: string | undefined): void {
  if (key) sessions.delete(key);
}
export type VideoPlaybackSession = {
  position: number;
  muted: boolean;
  updatedAt: number;
};

const sessions = new Map<string, VideoPlaybackSession>();

export function readVideoPlaybackSession(key: string | undefined): VideoPlaybackSession | null {
  if (!key) return null;
  return sessions.get(key) ?? null;
}

export function writeVideoPlaybackSession(
  key: string | undefined,
  position: number,
  muted: boolean,
): void {
  if (!key || !Number.isFinite(position) || position < 0) return;
  sessions.set(key, {
    position,
    muted,
    updatedAt: Date.now(),
  });
}

export function clearVideoPlaybackSession(key: string | undefined): void {
  if (key) sessions.delete(key);
}
