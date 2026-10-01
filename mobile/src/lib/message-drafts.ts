import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

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
  pendingText: { id: string; body: string; replyToMessageId?: string } | null;
  recoveryMessage?: string;
};
export type DraftSummary = { preview: string; updatedAt: string };
type Saved = ConversationDraft & { version: 1; updatedAt: string };
const prefix = "kampusone.message-draft.v1.";
const queues = new Map<string, Promise<void>>();
const listeners = new Set<(account: string) => void>();
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
    draft.batches.length
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
  return saved;
}
export async function readConversationDraft(
  account: string,
  thread: string,
): Promise<ConversationDraft | null> {
  const storageKey = key(account, thread);
  await queues.get(storageKey)?.catch(() => undefined);
  const saved = parse(await AsyncStorage.getItem(storageKey));
  if (!saved) return null;
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
): Promise<void> {
  const storageKey = key(account, thread);
  const snapshot = JSON.parse(JSON.stringify(draft)) as ConversationDraft;
  const task = (queues.get(storageKey) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const previous = parse(await AsyncStorage.getItem(storageKey));
      if (hasConversationDraft(snapshot)) {
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
        await AsyncStorage.setItem(
          storageKey,
          JSON.stringify({
            ...snapshot,
            version: 1,
            updatedAt: new Date().toISOString(),
          }),
        );
      } else {
        await AsyncStorage.removeItem(storageKey);
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
    });
  queues.set(storageKey, task);
  void task
    .finally(() => {
      if (queues.get(storageKey) === task) queues.delete(storageKey);
    })
    .catch(() => undefined);
  return task;
}
export async function readDraftSummaries(
  account: string,
): Promise<Record<string, DraftSummary>> {
  if (!validId(account)) return {};
  const accountPrefix = prefix + account + ".";
  const keys = (await AsyncStorage.getAllKeys()).filter((value) =>
    value.startsWith(accountPrefix),
  );
  const results: Record<string, DraftSummary> = {};
  for (const [storageKey, raw] of await AsyncStorage.multiGet(keys)) {
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
