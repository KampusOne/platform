import { describe, expect, it, vi } from "vitest";
import { createVoiceUploadQueue } from "../../mobile/src/lib/voice-upload";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe("voice recording uploads", () => {
  it("shares one pending upload between preview preupload and send", async () => {
    const pending = deferred<string>();
    const transport = vi.fn(() => pending.promise);
    const queue = createVoiceUploadQueue(transport);
    const draft = { localId: "recording-a", uri: "file:///a.m4a" };
    const preview = queue.upload(draft);
    const send = queue.upload(draft);
    expect(send).toBe(preview);
    await Promise.resolve();
    expect(transport).toHaveBeenCalledOnce();
    pending.resolve("media-a");
    expect(await send).toBe("media-a");
    expect(await queue.upload(draft)).toBe("media-a");
    expect(transport).toHaveBeenCalledOnce();
  });
  it("never substitutes an old recording when its upload finishes after the replacement", async () => {
    const old = deferred<string>();
    const next = deferred<string>();
    const transport = vi.fn((uri: string) => uri === "file:///old" ? old.promise : next.promise);
    const queue = createVoiceUploadQueue(transport);
    const oldDraft = { localId: "old", uri: "file:///old" };
    const nextDraft = { localId: "new", uri: "file:///new" };
    const first = queue.upload(oldDraft);
    const second = queue.upload(nextDraft);
    next.resolve("new-media");
    expect(await second).toBe("new-media");
    old.resolve("old-media");
    expect(await first).toBe("old-media");
    expect(await queue.upload(nextDraft)).toBe("new-media");
  });
  it("does not reuse cached bytes if a recorder reuses its URI for a new recording", async () => {
    const transport = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    const queue = createVoiceUploadQueue(transport);
    expect(await queue.upload({ localId: "a", uri: "file:///reused" })).toBe("first");
    expect(await queue.upload({ localId: "b", uri: "file:///reused" })).toBe("second");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("posts a restored recording reference without reading or uploading the file again", async () => {
    const transport = vi.fn();
    const queue = createVoiceUploadQueue(transport);
    const draft = { localId: "a", uri: "file:///retained", mediaId: "already-uploaded" };
    expect(await queue.upload(draft)).toBe("already-uploaded");
    expect(await queue.upload({ ...draft, mediaId: undefined })).toBe("already-uploaded");
    expect(transport).not.toHaveBeenCalled();
  });
  it("permits a retry after transport failure without retaining a rejected promise", async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("retried");
    const queue = createVoiceUploadQueue(transport);
    const draft = { localId: "a", uri: "file:///a" };
    await expect(queue.upload(draft)).rejects.toThrow("offline");
    expect(await queue.upload(draft)).toBe("retried");
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
