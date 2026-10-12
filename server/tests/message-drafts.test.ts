import { beforeEach, describe, expect, it, vi } from "vitest";
const memory = vi.hoisted(() => ({
  activeOwner:"",
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
vi.mock("../../mobile/src/lib/device-cache",()=>({getDeviceCacheRevision:()=>0,isDeviceCacheOwner:(id:string)=>id===memory.activeOwner,readCache:async()=>null,writeCache:async()=>{}}));
vi.mock("../../mobile/src/lib/secure-snapshots.native-adapter",async()=>{
 const {SecureSnapshots}=await import("../../mobile/src/lib/secure-snapshots");
 const {createCipheriv,createDecipheriv,randomBytes,createHash}=await import('node:crypto');
 const keys=new Map<string,Buffer>();
 const store=new SecureSnapshots({
  get:async key=>memory.storage.get(key)??null,set:async(key,value)=>{memory.storage.set(key,value);},remove:async key=>{memory.storage.delete(key);},keys:async()=>[...memory.storage.keys()],hash:async text=>createHash('sha256').update(text).digest('hex'),
  seal:async(id,text,aad)=>{const key=keys.get(id)??randomBytes(32);keys.set(id,key);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));return Buffer.concat([iv,cipher.update(text),cipher.final(),cipher.getAuthTag()]).toString('base64');},
  open:async(id,sealed,aad)=>{const key=keys.get(id);if(!key)return null;const bytes=Buffer.from(sealed,'base64'),cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAAD(Buffer.from(aad));cipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString();},
  destroyKey:async id=>{keys.delete(id);},
 });return {secureSnapshots:store};
});
import {secureSnapshots} from "../../mobile/src/lib/secure-snapshots.native-adapter";
import {
  readConversationDraft,
  readDraftSummaries,
  saveConversationDraft,
  queuedTextMessages,
  acknowledgePendingText,
  updatePendingTextRetry,
  restoreBlockedText,
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
beforeEach(async () => {
  await secureSnapshots.clear();
  memory.activeOwner=account;
  secureSnapshots.activate("verified-account:"+account,account);
  memory.storage.clear();
  memory.files.clear();
  memory.directories.clear();
});
describe("durable account-scoped message drafts", () => {
  it('rejects a 41st active draft without dropping any pending text, then reuses an empty thread',async()=>{
    const threads=Array.from({length:40},()=>crypto.randomUUID());
    for(const destination of threads)await saveConversationDraft(account,destination,draft({pendingText:{id:crypto.randomUUID(),body:'Retain '+destination,retry:{attempts:0,nextAttemptAt:0,blocked:false}}}));
    const next=crypto.randomUUID();await expect(saveConversationDraft(account,next,draft({text:'New composer'}))).rejects.toThrow('40 saved conversation drafts');
    expect(await queuedTextMessages(account)).toHaveLength(40);expect(await readConversationDraft(account,next)).toBeNull();
    const pending=(await readConversationDraft(account,threads[0]!))!.pendingText!;await acknowledgePendingText(account,threads[0]!,pending.id);
    await saveConversationDraft(account,next,draft({text:'New composer'}));expect((await readConversationDraft(account,next))?.text).toBe('New composer');expect(await queuedTextMessages(account)).toHaveLength(39);
  });
  it('retains queued text across reopening and keeps retry state when newer composer text is saved',async()=>{
    const message={id:crypto.randomUUID(),body:'Please send this once',retry:{attempts:0,nextAttemptAt:123,blocked:false}};
    await saveConversationDraft(account,thread,draft({pendingText:message}));
    await updatePendingTextRetry(account,thread,message.id,{attempts:2,nextAttemptAt:1000,blocked:false});
    await saveConversationDraft(account,thread,draft({text:'My newer unsent draft',pendingText:message}));
    const queued=await queuedTextMessages(account);expect(queued).toHaveLength(1);expect(queued[0]?.message.retry?.attempts).toBe(2);
    expect((await readConversationDraft(account,thread))?.text).toBe('My newer unsent draft');
    expect(await queuedTextMessages(secondAccount)).toEqual([]);
  });
  it('acknowledges only the matching intent, preserves a newer composer, and rejects stale resurrection',async()=>{
    const message={id:crypto.randomUUID(),body:'An already submitted text',retry:{attempts:0,nextAttemptAt:0,blocked:false}};
    const next=draft({text:'Do not overwrite this new draft',pendingText:message});
    await saveConversationDraft(account,thread,next);
    await acknowledgePendingText(account,thread,crypto.randomUUID());expect(await queuedTextMessages(account)).toHaveLength(1);
    await acknowledgePendingText(account,thread,message.id);
    await saveConversationDraft(account,thread,next);
    expect((await readConversationDraft(account,thread))?.pendingText).toBeNull();
    expect((await readConversationDraft(account,thread))?.text).toBe(next.text);expect(await queuedTextMessages(account)).toEqual([]);
  });
  it('does not replace a queued text with a second intent or restore a blocked text over a changed composer',async()=>{
    const message={id:crypto.randomUUID(),body:'Keep this pending text',retry:{attempts:5,nextAttemptAt:0,blocked:true}};
    await saveConversationDraft(account,thread,draft({text:'My current draft',pendingText:message}));
    await expect(saveConversationDraft(account,thread,draft({pendingText:{...message,id:crypto.randomUUID()}}))).rejects.toThrow('Finish the pending');
    await expect(restoreBlockedText(account,thread,message.id,'Older composer')).rejects.toThrow('Your draft changed');
    expect((await readConversationDraft(account,thread))?.text).toBe('My current draft');
    expect(await restoreBlockedText(account,thread,message.id,'My current draft')).toBe(message.body);
    expect((await readConversationDraft(account,thread))?.pendingText).toBeNull();expect((await readConversationDraft(account,thread))?.text).toBe(message.body);
  });
  it('never converts plaintext legacy retry metadata into an automatic send authority',async()=>{
    const message={id:crypto.randomUUID(),body:'Legacy pending text',retry:{attempts:0,nextAttemptAt:0,blocked:false}};
    memory.storage.set('kampusone.message-draft.v1.'+account+'.'+thread,JSON.stringify({...draft({pendingText:message}),version:1,updatedAt:new Date().toISOString()}));
    const recovered=await readConversationDraft(account,thread);expect(recovered?.pendingText?.body).toBe(message.body);expect(recovered?.pendingText?.retry).toBeUndefined();
    expect(await queuedTextMessages(account)).toEqual([]);
  });
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
