import { beforeEach, describe, expect, it, vi } from "vitest";
const memory = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  files: new Map<string, string>(),
  directories: new Set<string>(),
}));
vi.mock("../../mobile/node_modules/react-native/index.js", () => ({
  Platform: { OS: "android" },
}));
vi.mock(
  "../../mobile/node_modules/@react-native-async-storage/async-storage/lib/commonjs/index.js",
  () => ({
    default: {
      getItem: async (key: string) => memory.storage.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        memory.storage.set(key, value);
      },
      removeItem: async (key: string) => {
        memory.storage.delete(key);
      },
      getAllKeys: async () => [...memory.storage.keys()],
      multiGet: async (keys: string[]) =>
        keys.map((key) => [key, memory.storage.get(key) ?? null]),
    },
  }),
);
vi.mock("../../mobile/node_modules/expo-file-system/src/index.ts", () => {
  const path = (...parts: (string | { uri: string })[]) =>
    parts
      .map((value) => (typeof value === "string" ? value : value.uri))
      .join("/");
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = path(...parts);
    }
    get exists() {
      return memory.files.has(this.uri);
    }
    copy(destination: File) {
      memory.files.set(destination.uri, memory.files.get(this.uri)!);
    }
    delete() {
      memory.files.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = path(...parts);
    }
    get exists() {
      return memory.directories.has(this.uri);
    }
    create() {
      memory.directories.add(this.uri);
    }
    list() {
      return [...memory.files.keys()]
        .filter((uri) => uri.startsWith(this.uri + "/"))
        .map((uri) => new File(uri));
    }
    delete() {
      memory.directories.delete(this.uri);
    }
  }
  return { File, Directory, Paths: { document: "file:///documents" } };
});
import {
  readConversationDraft,
  readDraftSummaries,
  saveConversationDraft,
  type ConversationDraft,
} from "../../mobile/src/lib/message-drafts";
const account = crypto.randomUUID(),
  secondAccount = crypto.randomUUID(),
  thread = crypto.randomUUID(),
  localId = crypto.randomUUID();
function draft(overrides: Partial<ConversationDraft> = {}): ConversationDraft {
  return {
    text: "",
    media: [],
    voice: null,
    reply: null,
    batches: [],
    pendingText: null,
    ...overrides,
  };
}
beforeEach(() => {
  memory.storage.clear();
  memory.files.clear();
  memory.directories.clear();
});
describe("durable account-scoped message drafts", () => {
  it("restores text, reply and the original retry identifier after reopening", async () => {
    const id = crypto.randomUUID(),
      replyId = crypto.randomUUID();
    const original = draft({
      text: "I will send this later",
      pendingText: {
        id,
        body: "I will send this later",
        replyToMessageId: replyId,
      },
      reply: {
        id: replyId,
        sender_id: secondAccount,
        body: "A previous message",
        media_id: null,
        media_type: null,
        media_name: null,
        unsent_at: null,
      },
    });
    await saveConversationDraft(account, thread, original);
    expect(await readConversationDraft(account, thread)).toMatchObject(
      original,
    );
    expect(await readConversationDraft(secondAccount, thread)).toBeNull();
    expect(await readDraftSummaries(secondAccount)).toEqual({});
    expect((await readDraftSummaries(account))[thread]?.preview).toBe(
      original.text,
    );
  });
  it("copies attachments out of cache so they survive cache clearing", async () => {
    memory.files.set("file:///cache/photo.jpg", "image bytes");
    await saveConversationDraft(
      account,
      thread,
      draft({
        media: [
          {
            localId,
            uri: "file:///cache/photo.jpg",
            name: "photo.jpg",
            mimeType: "image/jpeg",
            kind: "image",
          },
        ],
      }),
    );
    memory.files.delete("file:///cache/photo.jpg");
    const restored = await readConversationDraft(account, thread);
    expect(restored?.media[0]?.uri).toContain(
      "file:///documents/message-drafts/",
    );
    expect(memory.files.get(restored!.media[0]!.uri)).toBe("image bytes");
    await saveConversationDraft(account, thread, draft());
    expect(await readConversationDraft(account, thread)).toBeNull();
    expect(memory.files.size).toBe(0);
  });
  it("keeps partial-send ids, uploaded media and confirmed items for a safe explicit retry", async () => {
    memory.files.set("file:///cache/video.mp4", "video bytes");
    const messageId = crypto.randomUUID(),
      mediaId = crypto.randomUUID();
    await saveConversationDraft(
      account,
      thread,
      draft({
        batches: [
          {
            id: crypto.randomUUID(),
            caption: "My video",
            status: "sending",
            items: [
              {
                localId,
                messageId,
                mediaId,
                sent: true,
                uri: "file:///cache/video.mp4",
                name: "video.mp4",
                mimeType: "video/mp4",
                kind: "video",
              },
            ],
          },
        ],
      }),
    );
    memory.files.delete("file:///cache/video.mp4");
    const restored = await readConversationDraft(account, thread);
    expect(restored?.batches[0]).toMatchObject({
      status: "failed",
      items: [{ messageId, mediaId, sent: true }],
    });
    expect((await readDraftSummaries(account))[thread]?.preview).toBe(
      "My video",
    );
  });
  it("preserves the last saved draft when a new cache attachment is missing", async () => {
    await saveConversationDraft(
      account,
      thread,
      draft({ text: "Keep this text" }),
    );
    await expect(
      saveConversationDraft(
        account,
        thread,
        draft({
          text: "New text",
          media: [
            {
              localId,
              uri: "file:///cache/missing",
              name: "missing.jpg",
              mimeType: "image/jpeg",
              kind: "image",
            },
          ],
        }),
      ),
    ).rejects.toThrow("no longer on this device");
    expect((await readConversationDraft(account, thread))?.text).toBe(
      "Keep this text",
    );
  });
  it("serializes fast edits so an older write cannot overwrite the latest text", async () => {
    await Promise.all([
      saveConversationDraft(account, thread, draft({ text: "A" })),
      saveConversationDraft(account, thread, draft({ text: "ABC" })),
      saveConversationDraft(account, thread, draft({ text: "Final draft" })),
    ]);
    expect((await readConversationDraft(account, thread))?.text).toBe(
      "Final draft",
    );
  });
  it("retains a recorded voice note and its retry metadata in durable storage", async () => {
    memory.files.set("file:///cache/voice.m4a", "recording bytes");
    const messageId = crypto.randomUUID(),
      mediaId = crypto.randomUUID();
    await saveConversationDraft(
      account,
      thread,
      draft({
        voice: {
          localId,
          uri: "file:///cache/voice.m4a",
          durationMs: 9000,
          messageId,
          mediaId,
        },
      }),
    );
    memory.files.delete("file:///cache/voice.m4a");
    expect((await readConversationDraft(account, thread))?.voice).toMatchObject(
      { localId, durationMs: 9000, messageId, mediaId },
    );
    expect((await readDraftSummaries(account))[thread]?.preview).toBe(
      "Voice note",
    );
  });
});
