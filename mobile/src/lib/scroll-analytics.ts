import { useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { analyticsScreenName, trackScrollDepth } from "./analytics";
export function useScrollAnalytics(pathname: string) {
  const seen = useRef({ pathname: "", depths: new Set<number>() });
  return (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (seen.current.pathname !== pathname)
      seen.current = { pathname, depths: new Set() };
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    if (contentOffset.y <= 0 || contentSize.height <= layoutMeasurement.height)
      return;
    const reached =
      ((contentOffset.y + layoutMeasurement.height) / contentSize.height) * 100;
    for (const depth of [25, 50, 75, 90] as const)
      if (reached >= depth && !seen.current.depths.has(depth)) {
        seen.current.depths.add(depth);
        trackScrollDepth(analyticsScreenName(pathname), depth);
      }
  };
}
