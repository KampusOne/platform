import { describe, expect, it, vi } from 'vitest';
import type { AudioPlayer, AudioStatus } from '../../mobile/node_modules/expo-audio/build/index';
import { createVoicePlaybackSession } from '../../mobile/src/lib/voice-playback';
function harness() {
  let released = false;
  let listener: ((status: AudioStatus) => void) | undefined;
  const initial = { isLoaded: true, duration: 12, currentTime: 0, playing: false, isBuffering: false, didJustFinish: false } as AudioStatus;
  const native = {
    get currentStatus() { if (released) throw new Error('SharedObject already released'); return initial; },
    shouldCorrectPitch: false,
    setPlaybackRate: vi.fn(() => { if (released) throw new Error('SharedObject already released'); }),
    play: vi.fn(() => { if (released) throw new Error('SharedObject already released'); listener?.({ ...initial, playing: true }); }),
    pause: vi.fn(() => { if (released) throw new Error('SharedObject already released'); }),
    release: vi.fn(() => { released = true; }),
    seekTo: vi.fn(async () => { if (released) throw new Error('SharedObject already released'); }),
    addListener: vi.fn((_event: string, next: (status: AudioStatus) => void) => { listener = next; return { remove: vi.fn() }; }),
  };
  const callbacks = { createPlayer: vi.fn(() => native as unknown as AudioPlayer), prepareAudio: vi.fn(async () => {}), onStatus: vi.fn(), onLoading: vi.fn(), onError: vi.fn() };
  return { session: createVoicePlaybackSession(callbacks), native, callbacks, notify: (status: Partial<AudioStatus>) => listener?.({ ...initial, ...status }) };
}
describe('on-demand voice playback lifecycle', () => {
  it('creates no native player until Play and signed URL resolution', async () => {
    const h = harness();
    expect(h.callbacks.createPlayer).not.toHaveBeenCalled();
    let resolve!: (uri: string) => void;
    const pending = h.session.toggle(() => new Promise<string>(done => { resolve = done; }));
    expect(h.callbacks.createPlayer).not.toHaveBeenCalled();
    resolve('https://private.example/voice'); await pending;
    expect(h.callbacks.createPlayer).toHaveBeenCalledOnce();
    expect(h.native.play).toHaveBeenCalledOnce(); h.session.dispose();
  });
  it('cancels a pending signed URL on navigation', async () => {
    const h = harness(); let resolve!: (uri: string) => void;
    const pending = h.session.toggle(() => new Promise<string>(done => { resolve = done; }));
    h.session.dispose(); h.callbacks.onLoading.mockClear();
    resolve('https://private.example/late'); await pending;
    expect(h.callbacks.createPlayer).not.toHaveBeenCalled();
    expect(h.callbacks.onLoading).not.toHaveBeenCalled();
  });
  it('cancels pending audio mode setup on navigation', async () => {
    const h = harness(); let resolve!: () => void;
    h.callbacks.prepareAudio.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    const pending = h.session.toggle(() => 'file:///voice.m4a'); await Promise.resolve();
    h.session.dispose(); resolve(); await pending;
    expect(h.callbacks.createPlayer).not.toHaveBeenCalled();
  });
  it('releases once and ignores late native events and repeated cleanup', async () => {
    const h = harness(); await h.session.toggle(() => 'file:///voice.m4a'); h.session.dispose();
    h.callbacks.onStatus.mockClear(); h.notify({ playing: true }); h.session.stop(); h.session.dispose();
    expect(h.native.release).toHaveBeenCalledOnce(); expect(h.native.pause).toHaveBeenCalledOnce();
    expect(h.callbacks.onStatus).not.toHaveBeenCalled();
  });
  it('handles synchronous status events without recursive playback', async () => {
    const h = harness(); h.session.setSpeed(1.5); await h.session.toggle(() => 'file:///voice.m4a');
    expect(h.native.play).toHaveBeenCalledOnce(); expect(h.native.setPlaybackRate).toHaveBeenCalledWith(1.5);
    h.notify({ didJustFinish: true, playing: false }); expect(h.native.release).toHaveBeenCalledOnce(); h.session.dispose();
  });
  it('pauses and resumes the existing player without reloading the voice note', async () => {
    const h = harness(); const source = vi.fn(() => 'file:///voice.m4a');
    await h.session.toggle(source); await h.session.toggle(source); await h.session.toggle(source);
    expect(source).toHaveBeenCalledOnce(); expect(h.callbacks.createPlayer).toHaveBeenCalledOnce();
    expect(h.native.pause).toHaveBeenCalledOnce(); expect(h.native.play).toHaveBeenCalledTimes(2); h.session.dispose();
  });
  it('keeps native initialization and interruption errors within the voice note', async () => {
    const h = harness(); h.callbacks.createPlayer.mockImplementationOnce(() => { throw new Error('SharedObject not available'); });
    await expect(h.session.toggle(() => 'file:///voice.m4a')).resolves.toBeUndefined();
    expect(h.callbacks.onError).toHaveBeenLastCalledWith('Voice note could not play. Tap to retry.');
    await h.session.toggle(() => 'file:///voice.m4a');
    h.native.pause.mockImplementation(() => { throw new Error('SharedObject already released'); });
    expect(() => h.session.dispose()).not.toThrow(); expect(h.native.release).toHaveBeenCalledOnce();
  });
});
