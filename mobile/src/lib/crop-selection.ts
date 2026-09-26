export type CropBox = { x: number; y: number; width: number; height: number };
export type Corner = 'tl' | 'tr' | 'bl' | 'br';
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export function initialCrop(width: number, height: number, aspect: number): CropBox {
  const w = Math.min(width, height * aspect), h = w / aspect;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}
export function moveCrop(box: CropBox, dx: number, dy: number, width: number, height: number): CropBox {
  return { ...box, x: clamp(box.x + dx, 0, width - box.width), y: clamp(box.y + dy, 0, height - box.height) };
}
export function resizeCrop(box: CropBox, dx: number, dy: number, corner: Corner, width: number, height: number): CropBox {
  const left = corner.endsWith('l'), top = corner.startsWith('t');
  const anchorX = left ? box.x + box.width : box.x, anchorY = top ? box.y + box.height : box.y;
  const aspect = box.width / box.height;
  const maxWidth = Math.min(left ? anchorX : width - anchorX, (top ? anchorY : height - anchorY) * aspect);
  const delta = Math.abs(dx) > Math.abs(dy * aspect) ? (left ? -dx : dx) : (top ? -dy : dy) * aspect;
  const w = clamp(box.width + delta, Math.min(48, maxWidth), maxWidth), h = w / aspect;
  return { x: left ? anchorX - w : anchorX, y: top ? anchorY - h : anchorY, width: w, height: h };
}
export function sourceCrop(box: CropBox, scale: number, width: number, height: number) {
  const originX = clamp(Math.round(box.x / scale), 0, width - 1), originY = clamp(Math.round(box.y / scale), 0, height - 1);
  return { originX, originY, width: clamp(Math.round(box.width / scale), 1, width - originX), height: clamp(Math.round(box.height / scale), 1, height - originY) };
}
