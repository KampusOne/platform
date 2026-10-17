/** Both sides of a conversation use the same physical leftward gesture. */
export function startsReplySwipe(dx: number, dy: number, disabled = false) {
  return !disabled && dx < -8 && Math.abs(dx) > Math.abs(dy) * 1.35;
}
export function completesReplySwipe(dx: number, dy: number, disabled = false) {
  return startsReplySwipe(dx, dy, disabled) && dx <= -52;
}
