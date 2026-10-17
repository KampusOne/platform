import Slider from '@react-native-community/slider';

export type PlaybackSliderProps = {
  value: number;
  duration: number;
  disabled: boolean;
  color: string;
  trackColor: string;
  valueText: string;
  onPreview: (value: number) => void;
  onSeek: (value: number) => void;
};

export function PlaybackSlider(props: PlaybackSliderProps) {
  return <Slider
    accessibilityLabel="Audio position"
    accessibilityValue={{ min: 0, max: props.duration, now: props.value, text: props.valueText }}
    minimumValue={0} maximumValue={props.duration || 1} step={1}
    value={props.value} disabled={props.disabled}
    minimumTrackTintColor={props.color} maximumTrackTintColor={props.trackColor} thumbTintColor={props.color}
    onSlidingStart={props.onPreview} onValueChange={props.onPreview} onSlidingComplete={props.onSeek}
    style={{ width: '100%', height: 44 }}
  />;
}
