/** Only consume the overlap that native adjustResize has not already removed. */
export function keyboardOverlap(viewY: number, viewHeight: number, keyboardY: number | null): number {
  if (keyboardY === null || ![viewY, viewHeight, keyboardY].every(Number.isFinite) || viewHeight <= 0) return 0;
  return Math.max(0, Math.min(viewHeight, viewY + viewHeight - keyboardY));
}
