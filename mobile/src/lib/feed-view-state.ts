/** Preserve row identities and skip state updates for already-confirmed views. */
export function applyPostViewCounts<T extends { id: string; view_count?: number | null }>(
  posts: T[],
  counts: ReadonlyMap<string, number>,
): T[] {
  let updated: T[] | undefined;
  for (let index = 0; index < posts.length; index++) {
    const post = posts[index]!;
    const incoming = counts.get(post.id);
    if (incoming === undefined || !Number.isFinite(incoming) || incoming < 0) continue;
    const current = Number.isFinite(post.view_count) ? post.view_count! : 0;
    const next = Math.max(current, Math.floor(incoming));
    if (post.view_count === next) continue;
    updated ??= posts.slice();
    updated[index] = { ...post, view_count: next };
  }
  return updated ?? posts;
}
