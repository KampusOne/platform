export type PhotoDimensions = { uri: string; width: number; height: number };
export type CropPosition = { x: number; y: number };
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The preview and exported crop use the same geometry, in source-image pixels. */
export function photoCrop(
  image: Pick<PhotoDimensions, "width" | "height">,
  frameWidth: number,
  aspect: number,
  zoom: number,
  position: CropPosition,
) {
  if (![image.width, image.height, frameWidth, aspect, zoom].every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error("This photo has invalid dimensions. Choose another image.");
  }
  const frameHeight = frameWidth / aspect;
  const scale = Math.max(frameWidth / image.width, frameHeight / image.height) * clamp(zoom, 1, 4);
  const width = image.width * scale, height = image.height * scale;
  const x = clamp(Number.isFinite(position.x) ? position.x : 0, -(width - frameWidth) / 2, (width - frameWidth) / 2);
  const y = clamp(Number.isFinite(position.y) ? position.y : 0, -(height - frameHeight) / 2, (height - frameHeight) / 2);
  const left = (frameWidth - width) / 2 + x, top = (frameHeight - height) / 2 + y;
  // Integer crops cannot overrun the image at extreme zoom or drag positions.
  const cropWidth = clamp(Math.round(frameWidth / scale), 1, Math.floor(image.width));
  const cropHeight = clamp(Math.round(frameHeight / scale), 1, Math.floor(image.height));
  return {
    frameHeight, width, height, left, top, position: { x, y },
    rect: {
      originX: clamp(Math.round(-left / scale), 0, image.width - cropWidth),
      originY: clamp(Math.round(-top / scale), 0, image.height - cropHeight),
      width: cropWidth, height: cropHeight,
    },
  };
}
