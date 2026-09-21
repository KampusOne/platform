export type PostLike = { id: string; liked: boolean; like_count: number };
export type LikeState = Readonly<{
  liked: boolean; count: number; ready: boolean; loading: boolean; pending: boolean; error: string;
}>;
export const initialLikeState: LikeState = Object.freeze({
  liked: false, count: 0, ready: false, loading: true, pending: false, error: "",
});
type Transport = {
  read(ids: string[]): Promise<{ likes: PostLike[] }>;
  write(id: string, liked: boolean): Promise<PostLike>;
};
type Entry = { state: LikeState; version: number; listeners: Set<() => void> };

function validLike(row: PostLike | undefined, id: string): row is PostLike {
  return !!row && row.id === id && typeof row.liked === "boolean"
    && Number.isSafeInteger(row.like_count) && row.like_count >= 0;
}

/** Shared by feed, saved posts and post detail; one batched read, not one request per card. */
export class PostLikeStore {
  private transport: Transport;
  private entries = new Map<string, Entry>();
  private queued = new Set<string>();
  private reading = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = true;

  constructor(transport: Transport) { this.transport = transport; }

  private entry(id: string): Entry {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { state: initialLikeState, version: 0, listeners: new Set() };
      this.entries.set(id, entry);
    }
    return entry;
  }

  get(id: string): LikeState { return this.entry(id).state; }

  subscribe(id: string, listener: () => void): () => void {
    const entry = this.entry(id);
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  }

  private publish(entry: Entry, state: LikeState): void {
    if (!this.active) return;
    entry.state = state;
    entry.listeners.forEach((listener) => listener());
  }

  load(id: string): void {
    if (!this.active || this.reading.has(id) || this.get(id).pending) return;
    const entry = this.entry(id);
    if (!entry.state.ready) this.publish(entry, { ...entry.state, loading: true, error: "" });
    this.queued.add(id);
    if (!this.timer) this.timer = setTimeout(() => { void this.flush(); }, 0);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    while (this.active && this.queued.size) {
      const batch = [...this.queued].slice(0, 50);
      batch.forEach((id) => this.queued.delete(id));
      const ids = batch.filter((id) => !this.reading.has(id) && !this.get(id).pending);
      if (!ids.length) continue;
      const versions = new Map(ids.map((id) => [id, this.entry(id).version]));
      ids.forEach((id) => this.reading.add(id));
      try {
        const response = await this.transport.read(ids);
        if (!Array.isArray(response.likes)) throw new Error("Invalid likes response");
        const rows = new Map(response.likes.map((row) => [row.id, row]));
        ids.forEach((id) => {
          const entry = this.entry(id), row = rows.get(id);
          // A late refresh must never overwrite a newer optimistic mutation.
          if (entry.version !== versions.get(id)) return;
          if (validLike(row, id)) {
            this.publish(entry, { liked: row.liked, count: row.like_count, ready: true, loading: false, pending: false, error: "" });
          } else {
            this.publish(entry, { ...entry.state, ready: false, loading: false, error: "This post is unavailable. Refresh the feed." });
          }
        });
      } catch {
        ids.forEach((id) => {
          const entry = this.entry(id);
          if (entry.version !== versions.get(id)) return;
          this.publish(entry, { ...entry.state, loading: false, error: "Likes could not load. Tap to retry." });
        });
      } finally {
        ids.forEach((id) => this.reading.delete(id));
      }
    }
  }

  async toggle(id: string): Promise<void> {
    const entry = this.entry(id), before = entry.state;
    // Synchronous guard also covers repeated taps before React re-renders.
    if (!this.active || !before.ready || before.pending) return;
    const liked = !before.liked, version = ++entry.version;
    this.publish(entry, { ...before, liked, count: Math.max(0, before.count + (liked ? 1 : -1)), pending: true, error: "" });
    try {
      // Explicit PUT / DELETE makes retrying an ambiguous network failure safe.
      const row = await this.transport.write(id, liked);
      if (!validLike(row, id)) throw new Error("Invalid likes response");
      if (entry.version !== version) return;
      this.publish(entry, { liked: row.liked, count: row.like_count, ready: true, loading: false, pending: false, error: "" });
    } catch {
      if (!this.active) return;
      const message = "Your like could not be saved. Check your connection and try again.";
      if (entry.version === version) this.publish(entry, { ...before, loading: false, pending: false, error: message });
      throw new Error(message);
    }
  }

  dispose(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.queued.clear();
    this.entries.forEach((entry) => entry.listeners.clear());
  }
}
