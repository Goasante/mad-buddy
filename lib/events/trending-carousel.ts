/** Navigation is visual only: the order still comes from ranked-events.ts. */
export function nextTrendingIndex(current: number, count: number, direction: -1 | 1): number {
  return count > 0 ? (current + direction + count) % count : 0;
}

/** Ignore vertical scrolling and incidental short touches on a card. */
export function trendingSwipeDirection(deltaX: number, deltaY: number): -1 | 0 | 1 {
  if (Math.abs(deltaX) < 40 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return 0;
  return deltaX < 0 ? 1 : -1;
}
