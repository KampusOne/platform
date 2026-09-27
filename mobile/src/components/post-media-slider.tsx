import { useState } from "react";
import { FlatList, Pressable, View, useWindowDimensions } from "react-native";
import type { FeedMediaItem } from "@/src/lib/feed-social";
import { MediaImage } from "./media-image";
import { ImageViewer } from "./image-viewer";

const gap = 8;

export function PostMediaSlider({ items }: { items: FeedMediaItem[] }) {
  const { width } = useWindowDimensions();
  const [viewer, setViewer] = useState<string | null>(null);
  const slideWidth = Math.min(340, Math.max(220, width - 105));
  const slideHeight = Math.min(340, Math.max(250, slideWidth * 1.04));

  if (!items.length) return null;

  return (
    <View style={{ marginTop: 8 }}>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item, index) => `${item.url}:${index}`}
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={slideWidth + gap}
        snapToAlignment="start"
        disableIntervalMomentum
        contentContainerStyle={{ gap, paddingRight: 28 }}
        renderItem={({ item, index }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View post image ${index + 1} of ${items.length}`}
            onPress={(event) => {
              event.stopPropagation();
              setViewer(item.url);
            }}
            style={{ width: slideWidth }}
          >
            <MediaImage
              uri={item.url}
              accessibilityLabel={`Post image ${index + 1} of ${items.length}`}
              resizeMode="cover"
              style={{ width: slideWidth, height: slideHeight, borderRadius: 12 }}
            />
          </Pressable>
        )}
      />
      <ImageViewer
        uri={viewer}
        label="Post image"
        downloadable
        onClose={() => setViewer(null)}
      />
    </View>
  );
}
