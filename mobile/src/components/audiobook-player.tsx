import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useAppearance } from '@/src/lib/appearance';
import { PlaybackSlider } from './playback-slider';
import { InlineLoading } from './skeleton';

const speeds = [1, 1.25, 1.5, 2];
const time = (value: number) => {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
type Props = { url: string; onRetry: () => void; onPrevious?: (() => void) | undefined; onNext?: (() => void) | undefined; chapter?: string | undefined };

export function AudiobookPlayer({ url, onRetry, onPrevious, onNext, chapter }: Props) {
  const { theme } = useAppearance();
  const player = useAudioPlayer(url, { updateInterval: 250, downloadFirst: false });
  const status = useAudioPlayerStatus(player);
  const [preview, setPreview] = useState<number | null>(null);
  const [repeat, setRepeat] = useState(false), [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState(''), [timedOut, setTimedOut] = useState(false);
  const alive = useRef(true), pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (status.isLoaded && !status.isBuffering) { setTimedOut(false); return; }
    const timer = setTimeout(() => setTimedOut(true), 15000);
    return () => clearTimeout(timer);
  }, [status.isLoaded, status.isBuffering]);
  const error = actionError || (timedOut || status.playbackState === 'error' || ('error' in status && status.error) ? 'Audio could not load. Check your connection and try again.' : '');
  const ready = status.isLoaded && !error;
  const duration = Number.isFinite(status.duration) ? Math.max(0, status.duration) : 0;
  const position = Math.min(duration, Math.max(0, preview ?? (Number.isFinite(status.currentTime) ? status.currentTime : 0)));
  const run = async (action: () => void | Promise<void>) => {
    if (pending.current || !ready) return;
    pending.current = true; setBusy(true); setActionError('');
    try { await action(); }
    catch { if (alive.current) setActionError('Audio could not play. Check your connection and try again.'); }
    finally { pending.current = false; if (alive.current) { setBusy(false); setPreview(null); } }
  };
  const seek = (value: number) => { void run(() => player.seekTo(Math.min(duration, Math.max(0, value)))); };
  const togglePlayback = () => { void run(async () => {
    if (status.playing) player.pause();
    else {
      if (status.didJustFinish || duration > 0 && status.currentTime >= duration) await player.seekTo(0);
      player.play();
    }
  }); };
  const controlStyle = { width: 44, height: 44, borderRadius: 22, alignItems: 'center' as const, justifyContent: 'center' as const };
  const disabled = !ready || busy;
  return <View accessibilityLabel="Audiobook player" style={{ padding: 18, gap: 6, backgroundColor: theme.surface, borderRadius: 18 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 4 }}>
      <Ionicons name="headset-outline" size={24} color={theme.deepBrand} />
      <Text style={{ color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 12 }}>Audiobook</Text>
    </View>
    <PlaybackSlider value={position} duration={duration} disabled={disabled || duration <= 0} color={theme.deepBrand} trackColor={theme.border} valueText={`${time(position)} of ${time(duration)}`} onPreview={setPreview} onSeek={seek} />
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: -6, marginBottom: 10 }}>
      <Text style={{ color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 12, fontVariant: ['tabular-nums'] }}>{time(position)}</Text>
      <Text style={{ color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 12, fontVariant: ['tabular-nums'] }}>{time(duration)}</Text>
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={repeat ? 'Turn repeat off' : 'Repeat audio'} accessibilityState={{ selected: repeat, disabled }} disabled={disabled} onPress={() => { void run(() => { player.loop = !repeat; setRepeat(!repeat); }); }} style={[controlStyle, { opacity: disabled ? 0.4 : 1, backgroundColor: repeat ? theme.surfaceTint : 'transparent' }]}>
        <Ionicons name="repeat" size={24} color={repeat ? theme.deepBrand : theme.textMuted} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Back 15 seconds" accessibilityState={{ disabled }} disabled={disabled} onPress={() => seek(status.currentTime - 15)} style={[controlStyle, { opacity: disabled ? 0.4 : 1 }]}>
        <Ionicons name="play-back" size={21} color={theme.deepBrand} /><Text style={{ color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 9 }}>15</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={status.playing ? 'Pause audio' : 'Play audio'} accessibilityState={{ disabled }} disabled={disabled} onPress={togglePlayback} style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.deepBrand, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
        {status.isBuffering || !status.isLoaded && !error ? <InlineLoading color={theme.warmWhite} size={24} /> : <Ionicons name={status.playing ? 'pause' : 'play'} size={30} color={theme.warmWhite} style={{ marginLeft: status.playing ? 0 : 3 }} />}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Forward 15 seconds" accessibilityState={{ disabled }} disabled={disabled} onPress={() => seek(status.currentTime + 15)} style={[controlStyle, { opacity: disabled ? 0.4 : 1 }]}>
        <Ionicons name="play-forward" size={21} color={theme.deepBrand} /><Text style={{ color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 9 }}>15</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Playback speed ${speed} times. Change speed`} accessibilityState={{ disabled }} disabled={disabled} onPress={() => { void run(() => { const next = speeds[(speeds.indexOf(speed) + 1) % speeds.length] ?? 1; player.setPlaybackRate(next); setSpeed(next); }); }} style={[controlStyle, { opacity: disabled ? 0.4 : 1 }]}>
        <Text style={{ color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 12 }}>{speed}×</Text>
      </Pressable>
    </View>
    {chapter ? <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous chapter" accessibilityState={{ disabled: !onPrevious }} disabled={!onPrevious} onPress={onPrevious} style={[controlStyle, { opacity: onPrevious ? 1 : 0.35 }]}><Ionicons name="play-skip-back" size={22} color={theme.deepBrand} /></Pressable>
      <Text style={{ color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 12 }}>{chapter}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Next chapter" accessibilityState={{ disabled: !onNext }} disabled={!onNext} onPress={onNext} style={[controlStyle, { opacity: onNext ? 1 : 0.35 }]}><Ionicons name="play-skip-forward" size={22} color={theme.deepBrand} /></Pressable>
    </View> : null}
    {error ? <View style={{ gap: 4, marginTop: 10 }}><Text accessibilityRole="alert" style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, lineHeight: 18 }}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry audio" onPress={onRetry} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: theme.deepBrand, fontFamily: theme.font.semibold }}>Try again</Text></Pressable></View> : !status.isLoaded || status.isBuffering ? <Text accessibilityLiveRegion="polite" style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, textAlign: 'center', marginTop: 8 }}>{status.isLoaded ? 'Buffering audio…' : 'Loading audio…'}</Text> : null}
  </View>;
}
