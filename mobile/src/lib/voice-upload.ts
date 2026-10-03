type UploadDraft = { localId: string; uri: string; mediaId?: string };

/** Keep uploads bound to the recording, including when a discarded upload finishes late. */
export function createVoiceUploadQueue(upload: (uri: string) => Promise<string>) {
  const pending = new Map<string, Promise<string>>();
  return {
    upload(draft: UploadDraft): Promise<string> {
      const key = `${draft.localId}\n${draft.uri}`;
      if (draft.mediaId) {
        const result = Promise.resolve(draft.mediaId);
        pending.set(key, result);
        return result;
      }
      const existing = pending.get(key);
      if (existing) return existing;
      const result = Promise.resolve().then(() => upload(draft.uri));
      pending.set(key, result);
      void result.catch(() => {
        // A failed upload may be retried; do not evict a newer restored result.
        if (pending.get(key) === result) pending.delete(key);
      });
      return result;
    },
  };
}
