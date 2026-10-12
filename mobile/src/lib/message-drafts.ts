import { privateDraftStorage } from "./private-draft-storage";
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import type { PendingText, QueuedText } from './text-retry-coordinator';
import {getDeviceCacheRevision,isDeviceCacheOwner} from './device-cache';

export type DraftAttachment = {
  localId: string;
  uri: string;
  name: string;
  mimeType: string;
  size?: number | null;
  kind: "image" | "video" | "document";
};
export type DraftReply = {
  id: string;
  sender_id: string;
  body: string;
  media_id: string | null;
  media_type: string | null;
  media_name: string | null;
  unsent_at: string | null;
};
export type VoiceDraft = {
  localId: string;
  uri: string;
  durationMs: number;
  mediaId?: string;
  messageId?: string;
  replyToMessageId?: string;
};
export type DraftBatch = {
  id: string;
  caption: string;
  status: "sending" | "failed";
  error?: string | undefined;
  replyToMessageId?: string;
  items: (DraftAttachment & {
    messageId: string;
    mediaId?: string;
    sent: boolean;
  })[];
};
export type ConversationDraft = {
  text: string;
  media: DraftAttachment[];
  reply: DraftReply | null;
  voice: VoiceDraft | null;
  batches: DraftBatch[];
  pendingText: PendingText | null;
  recoveryMessage?: string;
};
export type DraftSummary = { preview: string; updatedAt: string };
type Saved = ConversationDraft & { version: 1; updatedAt: string; closedTextIds?:string[] };
const prefix = "kampusone.message-draft.v1.";
const queues = new Map<string, Promise<void>>();
const listeners = new Set<(account: string) => void>();
const pendingListeners=new Set<(account:string)=>void>();
const deliveredListeners=new Set<(account:string,thread:string,id:string)=>void>();
export function onPendingTextChange(listener:(account:string)=>void){pendingListeners.add(listener);return()=>{pendingListeners.delete(listener);};}
export function onTextDelivered(listener:(account:string,thread:string,id:string)=>void){deliveredListeners.add(listener);return()=>{deliveredListeners.delete(listener);};}
const blobUrls = new Map<string, string>();
const validId = (value: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function key(account: string, thread: string) {
  if (!validId(account) || !validId(thread))
    throw new Error(
      "This draft does not have a valid account and conversation.",
    );
  return prefix + account + "." + thread;
}
export function hasConversationDraft(draft: ConversationDraft) {
  return !!(
    draft.text.trim() ||
    draft.media.length ||
    draft.voice ||
    draft.reply ||
    draft.batches.length ||
    draft.pendingText
  );
}
export function onMessageDraftChange(listener: (account: string) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function blobDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("kampusone-message-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("media");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("Your browser could not save draft attachments."));
  });
}
async function blobOperation<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await blobDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("media", mode);
      const request = operation(transaction.objectStore("media"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () =>
        reject(new Error("Your browser could not save draft attachments."));
    });
  } finally {
    db.close();
  }
}
async function retainUri(storageKey: string, localId: string, uri: string) {
  if (!validId(localId))
    throw new Error("This attachment could not be saved as a draft.");
  if (Platform.OS === "web") {
    const blobKey = `${storageKey}/${localId}`;
    if (!(await blobOperation("readonly", (store) => store.get(blobKey)))) {
      const response = await fetch(uri);
      if (!response.ok)
        throw new Error("Choose this attachment again so it can be saved.");
      const blob = await response.blob();
      await blobOperation("readwrite", (store) => store.put(blob, blobKey));
    }
    return "draft-blob:" + blobKey;
  }
  const directory = new Directory(Paths.document, "message-drafts", storageKey);
  directory.create({ idempotent: true, intermediates: true });
  const destination = new File(directory, localId);
  if (!destination.exists) {
    const source = new File(uri);
    if (!source.exists)
      throw new Error(
        "This attachment is no longer on this device. Choose it again.",
      );
    source.copy(destination);
  }
  return destination.uri;
}
async function restoreUri(uri: string) {
  if (Platform.OS !== "web") {
    if (!new File(uri).exists)
      throw new Error(
        "A draft attachment is missing. Choose the file again before sending.",
      );
    return uri;
  }
  if (!uri.startsWith("draft-blob:"))
    throw new Error("This draft attachment cannot be restored.");
  const blobKey = uri.slice(11);
  if (blobUrls.has(blobKey)) return blobUrls.get(blobKey)!;
  const blob = await blobOperation<Blob | undefined>("readonly", (store) =>
    store.get(blobKey),
  );
  if (!blob)
    throw new Error(
      "Your browser no longer has this draft attachment. Choose it again.",
    );
  const url = URL.createObjectURL(blob);
  blobUrls.set(blobKey, url);
  return url;
}
function parse(raw: string | null): Saved | null {
  if (!raw) return null;
  const saved = JSON.parse(raw) as Saved;
  if (
    saved.version !== 1 ||
    typeof saved.text !== "string" ||
    !Array.isArray(saved.media) ||
    !Array.isArray(saved.batches)
  )
    throw new Error("This saved draft could not be read.");
  saved.closedTextIds=Array.isArray(saved.closedTextIds)?saved.closedTextIds.filter(validId).slice(-40):[];
  return saved;
}
export async function readConversationDraft(
  account: string,
  thread: string,
): Promise<ConversationDraft | null> {
  const storageKey = key(account, thread);
  await queues.get(storageKey)?.catch(() => undefined);
  const saved = parse(await privateDraftStorage.getItem(storageKey));
  if (!saved || !hasConversationDraft(saved)) return null;
  for (const file of [
    ...saved.media,
    ...saved.batches.flatMap((batch) => batch.items),
    ...(saved.voice ? [saved.voice] : []),
  ]) {
    try {
      file.uri = await restoreUri(file.uri);
    } catch {
      saved.recoveryMessage =
        "An attachment is missing from this device. Remove it and choose the file again before sending.";
    }
  }
  // Never automatically send an interrupted batch after reopening the app.
  saved.batches = saved.batches.map((batch) => ({
    ...batch,
    status: "failed",
    error: "Send interrupted. Tap Retry to finish the remaining messages.",
  }));
  return saved;
}
export function saveConversationDraft(
  account: string,
  thread: string,
  draft: ConversationDraft,
  expectedRevision=getDeviceCacheRevision(),
): Promise<void> {
  const storageKey = key(account, thread);
  const revision=expectedRevision;
  const snapshot = JSON.parse(JSON.stringify(draft)) as ConversationDraft;
  const task = (queues.get(storageKey) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      if(revision!==getDeviceCacheRevision()||!isDeviceCacheOwner(account))throw new Error('This draft belongs to a different session.');
      const previous = parse(await privateDraftStorage.getItem(storageKey));
      if(revision!==getDeviceCacheRevision()||!isDeviceCacheOwner(account))throw new Error('This draft belongs to a different session.');
      const closedTextIds=(previous?.closedTextIds??[]).filter(validId).slice(-40);
      if(snapshot.pendingText&&closedTextIds.includes(snapshot.pendingText.id))snapshot.pendingText=null;
      if(previous?.pendingText?.retry){
        if(snapshot.pendingText&&snapshot.pendingText.id!==previous.pendingText.id)throw new Error('Finish the pending text message before sending another.');
        snapshot.pendingText=previous.pendingText;
      }
      if (hasConversationDraft(snapshot) || closedTextIds.length) {
        for (const file of [
          ...snapshot.media,
          ...snapshot.batches.flatMap((batch) => batch.items),
        ])
          file.uri = await retainUri(storageKey, file.localId, file.uri);
        if (snapshot.voice)
          snapshot.voice.uri = await retainUri(
            storageKey,
            snapshot.voice.localId,
            snapshot.voice.uri,
          );
        if(revision!==getDeviceCacheRevision()||!isDeviceCacheOwner(account))throw new Error('This draft belongs to a different session.');
        await privateDraftStorage.setItem(
          storageKey,
          JSON.stringify({
            ...snapshot,
            version: 1,
            updatedAt: new Date().toISOString(),
            closedTextIds,
          }),
        );
      } else {
        await privateDraftStorage.removeItem(storageKey);
      }
      const retained = new Set(
        [
          ...snapshot.media,
          ...snapshot.batches.flatMap((batch) => batch.items),
        ].map((file) => file.uri),
      );
      if (snapshot.voice) retained.add(snapshot.voice.uri);
      if (Platform.OS === "web") {
        const obsolete = [
          ...(previous?.media ?? []),
          ...(previous?.batches.flatMap((batch) => batch.items) ?? []),
          ...(previous?.voice ? [previous.voice] : []),
        ]
          .map((file) => file.uri)
          .filter((uri) => !retained.has(uri) && uri.startsWith("draft-blob:"));
        for (const uri of obsolete) {
          const blobKey = uri.slice(11);
          await blobOperation("readwrite", (store) => store.delete(blobKey));
          const url = blobUrls.get(blobKey);
          if (url) URL.revokeObjectURL(url);
          blobUrls.delete(blobKey);
        }
      } else {
        const directory = new Directory(
          Paths.document,
          "message-drafts",
          storageKey,
        );
        if (directory.exists) {
          for (const file of directory.list())
            if (file instanceof File && !retained.has(file.uri)) file.delete();
          if (!retained.size) directory.delete();
        }
      }
      for (const listener of listeners) listener(account);
      if(previous?.pendingText?.id!==snapshot.pendingText?.id)for(const listener of pendingListeners)listener(account);
    });
  queues.set(storageKey, task);
  void task
    .finally(() => {
      if (queues.get(storageKey) === task) queues.delete(storageKey);
    })
    .catch(() => undefined);
  return task;
}
/** Atomic metadata changes share the existing draft queue and preserve newer composer/media edits. */
function changePendingText(account:string,thread:string,messageId:string,retry:PendingText['retry']|null):Promise<void>{
  const storageKey=key(account,thread);
  const revision=getDeviceCacheRevision();
  const task=(queues.get(storageKey)??Promise.resolve()).catch(()=>undefined).then(async()=>{
    const saved=parse(await privateDraftStorage.getItem(storageKey));
    if(revision!==getDeviceCacheRevision()||!isDeviceCacheOwner(account))return;
    if(!saved||saved.pendingText?.id!==messageId)return;
    if(retry)saved.pendingText={...saved.pendingText,retry};
    else{saved.pendingText=null;saved.closedTextIds=[...new Set([...(saved.closedTextIds??[]),messageId])].slice(-40);}
    await privateDraftStorage.setItem(storageKey,JSON.stringify({...saved,updatedAt:new Date().toISOString()}));
    for(const listener of listeners)listener(account);
    for(const listener of pendingListeners)listener(account);
    if(!retry)for(const listener of deliveredListeners)listener(account,thread,messageId);
  });
  queues.set(storageKey,task);void task.finally(()=>{if(queues.get(storageKey)===task)queues.delete(storageKey);}).catch(()=>undefined);return task;
}
export const acknowledgePendingText=(account:string,thread:string,messageId:string)=>changePendingText(account,thread,messageId,null);
export const updatePendingTextRetry=(account:string,thread:string,messageId:string,retry:NonNullable<PendingText['retry']>)=>changePendingText(account,thread,messageId,retry);
export async function readPendingText(account:string,thread:string):Promise<PendingText|null>{const storageKey=key(account,thread);await queues.get(storageKey)?.catch(()=>undefined);return parse(await privateDraftStorage.getItem(storageKey))?.pendingText??null;}
export function restoreBlockedText(account:string,thread:string,messageId:string,expectedComposer:string):Promise<string>{
  const storageKey=key(account,thread),revision=getDeviceCacheRevision();
  const task=(queues.get(storageKey)??Promise.resolve()).catch(()=>undefined).then(async()=>{
    const saved=parse(await privateDraftStorage.getItem(storageKey));
    if(revision!==getDeviceCacheRevision()||!isDeviceCacheOwner(account))throw new Error('Your session changed. Reopen this draft.');
    if(!saved?.pendingText||saved.pendingText.id!==messageId||!saved.pendingText.retry?.blocked)throw new Error('This text is still being retried or has already been confirmed.');
    if(saved.text!==expectedComposer)throw new Error('Your draft changed. Review it before replacing it.');
    const body=saved.pendingText.body;saved.pendingText=null;saved.text=body;saved.reply=null;
    saved.closedTextIds=[...new Set([...(saved.closedTextIds??[]),messageId])].slice(-40);
    await privateDraftStorage.setItem(storageKey,JSON.stringify({...saved,updatedAt:new Date().toISOString()}));
    for(const listener of listeners)listener(account);for(const listener of pendingListeners)listener(account);return body;
  });
  const queued=task.then(()=>undefined,()=>undefined);queues.set(storageKey,queued);void task.finally(()=>{if(queues.get(storageKey)===queued)queues.delete(storageKey);}).catch(()=>undefined);return task;
}
export async function queuedTextMessages(account:string):Promise<QueuedText[]>{
  const accountPrefix=prefix+account+'.';
  const result:QueuedText[]=[];
  for(const storageKey of (await privateDraftStorage.keys(account)).slice(0,40)){
    try{
      const threadId=storageKey.slice(accountPrefix.length),saved=parse(await privateDraftStorage.getItem(storageKey)),message=saved?.pendingText,retry=message?.retry;
      if(!validId(threadId)||!message||!validId(message.id)||typeof message.body!=='string'||!message.body.trim()||message.body.length>5000||message.replyToMessageId&&!validId(message.replyToMessageId)||!retry||!Number.isSafeInteger(retry.attempts)||retry.attempts<0||!Number.isFinite(retry.nextAttemptAt)||typeof retry.blocked!=='boolean')continue;
      result.push({threadId,message});
    }catch{/* One unreadable record cannot authorize a send or block other drafts. */}
  }
  return result;
}
export async function readDraftSummaries(
  account: string,
): Promise<Record<string, DraftSummary>> {
  if (!validId(account)) return {};
  const accountPrefix = prefix + account + ".";
  const keys = await privateDraftStorage.keys(account);
  const results: Record<string, DraftSummary> = {};
  for (const [storageKey, raw] of await Promise.all(keys.map(async key => [key, await privateDraftStorage.getItem(key)] as const))) {
    let saved: Saved | null;
    try {
      saved = parse(raw);
    } catch {
      continue;
    }
    if (!saved || !hasConversationDraft(saved)) continue;
    results[storageKey.slice(accountPrefix.length)] = {
      preview:
        saved.text.trim() ||
        (saved.pendingText?'Pending · '+saved.pendingText.body:'') ||
        saved.batches[0]?.caption ||
        (saved.voice
          ? "Voice note"
          : saved.media.length || saved.batches.length
            ? "Attachment"
            : "Reply"),
      updatedAt: saved.updatedAt,
    };
  }
  return results;
}
