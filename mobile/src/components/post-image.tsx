import { useEffect, useState } from "react";
import { Image, Pressable } from "react-native";
import { MediaImage } from "./media-image";
import { ImageViewer } from "./image-viewer";

const dimensions = new Map<string, number>();
export function PostImage({ uri, label = "Post attachment" }: { uri: string; label?: string }) {
  const [aspect, setAspect] = useState(dimensions.get(uri) ?? 1);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    if (dimensions.has(uri)) { setAspect(dimensions.get(uri)!); return; }
    Image.getSize(uri, (width, height) => {
      if (width > 0 && height > 0) {
        const ratio = width / height;
        if (dimensions.size > 200) dimensions.clear();
        dimensions.set(uri, ratio);
        if (active) setAspect(ratio);
      }
    }, () => {});
    return () => { active = false; };
  }, [uri]);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`View ${label.toLowerCase()}`} onPress={(event) => { event.stopPropagation(); setOpen(true); }} style={{ marginTop: 8 }}>
      <MediaImage uri={uri} accessibilityLabel={label} resizeMode="contain" style={{ width: "100%", aspectRatio: aspect, borderRadius: 12 }} />
    </Pressable>
    <ImageViewer uri={open ? uri : null} label={label} onClose={() => setOpen(false)} />
  </>;
}
