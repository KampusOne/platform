import type { AudioPlayer, AudioStatus } from 'expo-audio';

/** Native audio objects are created only after Play, and are never read in render. */
export function createVoicePlaybackSession(options: {
  createPlayer: (uri: string) => AudioPlayer;
  prepareAudio: () => Promise<void>;
  onStatus: (status: Partial<AudioStatus>) => void;
  onLoading: (loading: boolean) => void;
  onError: (message: string) => void;
}) {
  let player: AudioPlayer | null = null;
  let subscription: { remove(): void } | null = null;
  let status: Partial<AudioStatus> = {};
  let disposed = false;
  let requested = false;
  let generation = 0;
  let speed = 1;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearLoading() {
    if (timer) clearTimeout(timer);
    timer = null;
    requested = false;
    if (!disposed) options.onLoading(false);
  }

  function release() {
    const previous = player;
    player = null;
    try { subscription?.remove(); } catch { /* Native listener was already removed. */ }
    subscription = null;
    if (previous) {
      try { previous.pause(); } catch { /* The OS may have interrupted playback. */ }
      try { previous.release(); } catch { /* Release remains idempotent. */ }
    }
  }

  function fail(message: string) {
    generation += 1;
    clearLoading();
    release();
    if (!disposed) options.onError(message);
  }

  function startLoaded(current: AudioPlayer, token: number) {
    if (disposed || token !== generation || current !== player || !requested || !status.isLoaded) return;
    try {
      // These native calls can synchronously emit another status event.
      clearLoading();
      current.setPlaybackRate(speed);
      current.shouldCorrectPitch = true;
      current.play();
    } catch { fail('Voice note could not play. Tap to retry.'); }
  }

  return {
    async toggle(source: () => string | Promise<string>) {
      if (disposed) return;
      options.onError('');
      if (requested) {
        this.stop();
        return;
      }
      if (player && status.playing) {
        try {
          player.pause();
          status = { ...status, playing: false };
          options.onStatus(status);
        } catch { fail('Voice note could not pause. Tap to retry.'); }
        return;
      }
      if (player && status.isLoaded) {
        requested = true;
        startLoaded(player, generation);
        return;
      }
      const token = ++generation;
      requested = true;
      options.onLoading(true);
      timer = setTimeout(() => {
        if (token === generation && !disposed) fail('Voice note took too long to load. Tap to retry.');
      }, 20_000);
      try {
        const uri = await source();
        if (disposed || token !== generation) return;
        if (!uri) throw new Error('Missing voice note');
        await options.prepareAudio();
        if (disposed || token !== generation) return;
        const current = options.createPlayer(uri);
        player = current;
        subscription = current.addListener('playbackStatusUpdate', (next: AudioStatus) => {
          if (disposed || token !== generation || current !== player) return;
          status = next;
          options.onStatus(next);
          if (next.error) { fail('Voice note could not play. Tap to retry.'); return; }
          if (next.didJustFinish) { this.stop(); return; }
          startLoaded(current, token);
        });
        status = current.currentStatus;
        options.onStatus(status);
        startLoaded(current, token);
      } catch {
        if (!disposed && token === generation) fail('Voice note could not play. Tap to retry.');
      }
    },
    setSpeed(value: number) {
      speed = value;
      if (!player || !status.isLoaded || disposed) return;
      try { player.setPlaybackRate(value); }
      catch { fail('Could not change playback speed. Tap to retry.'); }
    },
    async seek(seconds: number) {
      const current = player;
      if (!current || !status.isLoaded || disposed) return;
      const token = generation;
      try { await current.seekTo(seconds); }
      catch { if (!disposed && token === generation) fail('Could not seek. Tap to retry.'); }
    },
    stop() {
      if (!player && !requested) return;
      generation += 1;
      clearLoading();
      release();
      status = { ...status, playing: false, isBuffering: false, isLoaded: false };
      if (!disposed) options.onStatus(status);
    },
    dispose() {
      disposed = true;
      this.stop();
    },
  };
}
