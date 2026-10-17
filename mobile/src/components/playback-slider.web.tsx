import type { PlaybackSliderProps } from './playback-slider';

/** A real range input also supports keyboard seeking in the web app. */
export function PlaybackSlider(props: PlaybackSliderProps) {
  return <input type="range" aria-label="Audio position" aria-valuetext={props.valueText}
    min={0} max={props.duration || 1} step={1} value={props.value} disabled={props.disabled}
    onChange={event => { const value = event.currentTarget.valueAsNumber; props.onPreview(value); props.onSeek(value); }}
    style={{ width: '100%', height: 44, margin: 0, accentColor: props.color, cursor: props.disabled ? 'default' : 'pointer' }}
  />;
}
