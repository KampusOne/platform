import { describe, expect, it, vi } from "vitest";
import { createVideoPlaybackLifecycle } from "../../mobile/src/lib/video-playback-lifecycle";

const visible = { focused: true, active: true, wantsToPlay: true, status: "readyToPlay" };
describe("full-screen video playback lifecycle", () => {
  it("does not play from focus or a manual request while the current source is replacing", async () => {
    const lifecycle = createVideoPlaybackLifecycle();
    const play = vi.fn();
    const requestPlay = () => { if (lifecycle.canPlay(visible)) play(); };
    let resolve!: () => void;
    const replacement = new Promise<void>(done => { resolve = done; });
    const version = lifecycle.beginSource();
    const loading = replacement.then(() => { lifecycle.completeSource(version); requestPlay(); });
    requestPlay();
    requestPlay();
    expect(play).not.toHaveBeenCalled();
    resolve(); await loading;
    expect(play).toHaveBeenCalledOnce();
  });
  it("ignores an older replacement completing after a new source began", () => {
    const lifecycle = createVideoPlaybackLifecycle();
    const old = lifecycle.beginSource();
    const current = lifecycle.beginSource();
    expect(lifecycle.completeSource(old)).toBe(false);
    expect(lifecycle.canPlay(visible)).toBe(false);
    expect(lifecycle.completeSource(current)).toBe(true);
    expect(lifecycle.canPlay(visible)).toBe(true);
  });
  it.each([
    { ...visible, focused: false },
    { ...visible, active: false },
    { ...visible, wantsToPlay: false },
    { ...visible, status: "loading" },
    { ...visible, status: "error" },
  ])("keeps a completed source paused when lifecycle state forbids playback: %j", context => {
    const lifecycle = createVideoPlaybackLifecycle();
    lifecycle.completeSource(lifecycle.beginSource());
    expect(lifecycle.canPlay(context)).toBe(false);
    expect(lifecycle.canPlay(visible)).toBe(true);
  });
  it("invalidates a source on cleanup so its later resolution cannot resume playback", () => {
    const lifecycle = createVideoPlaybackLifecycle();
    const version = lifecycle.beginSource();
    lifecycle.invalidate(version);
    expect(lifecycle.completeSource(version)).toBe(false);
    expect(lifecycle.canPlay(visible)).toBe(false);
  });
});
