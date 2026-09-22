import { api } from "./api";

// A view is submitted by a visible feed row or an opened detail screen, never by render.
// The server deduplicates by signed-in viewer and post; this cache only avoids traffic.
const confirmed = new Map<string, number>();
const pending = new Map<string, Promise<number | null>>();
export function recordPostView(postId: string, viewerId: string): Promise<number | null> {
  const key = `${viewerId}:${postId}`;
  if (confirmed.has(key)) return Promise.resolve(confirmed.get(key)!);
  const existing = pending.get(key);
  if (existing) return existing;
  const task = api<{ view_count: number }>(`/v1/student/feed/${encodeURIComponent(postId)}/view`, { method: "PUT" })
    .then((result) => {
      const count = Number(result.view_count);
      if (!Number.isFinite(count) || count < 0) return null;
      confirmed.set(key, Math.floor(count));
      while (confirmed.size > 500) confirmed.delete(confirmed.keys().next().value!);
      return Math.floor(count);
    })
    .catch(() => null) // Analytics must not prevent reading a conversation.
    .finally(() => { pending.delete(key); });
  pending.set(key, task);
  return task;
}
