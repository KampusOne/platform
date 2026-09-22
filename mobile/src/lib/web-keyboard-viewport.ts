import { useEffect, useState } from "react";
import { Platform, type ViewStyle } from "react-native";

// Mobile browsers shrink the visual viewport, not always window.innerHeight.
// Keep the image/camera toolbar above the on-screen keyboard without affecting native layouts.
export function useWebKeyboardViewport(): ViewStyle | undefined {
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || !window.visualViewport) return;
    const visual = window.visualViewport;
    const update = () => setViewport({ height: visual.height, top: visual.offsetTop });
    update(); visual.addEventListener("resize", update); visual.addEventListener("scroll", update);
    return () => { visual.removeEventListener("resize", update); visual.removeEventListener("scroll", update); };
  }, []);
  return viewport ? { position: "absolute", left: 0, right: 0, top: viewport.top, height: viewport.height, flex: 0 } : undefined;
}
