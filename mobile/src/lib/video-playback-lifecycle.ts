/** A replaced source is playable only after its own replacement resolves. */
export function createVideoPlaybackLifecycle() {
  let version = 0;
  let completed = false;
  return {
    beginSource() { completed = false; return ++version; },
    currentVersion() { return version; },
    completeSource(candidate: number) {
      if (candidate !== version) return false;
      completed = true;
      return true;
    },
    invalidate(candidate: number) {
      if (candidate === version) { completed = false; version++; }
    },
    canPlay(context: { focused: boolean; active: boolean; wantsToPlay: boolean; status: string }) {
      return completed && context.focused && context.active && context.wantsToPlay && context.status === "readyToPlay";
    },
  };
}
