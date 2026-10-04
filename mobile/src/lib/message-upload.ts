import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { File, FileMode, type FileHandle } from 'expo-file-system';
import { api } from './api';

type UploadSession = {
  id: string;
  parts: Record<string, { size: number }>;
  status: string;
  mediaId: string | null;
  chunkBytes: number;
};

export async function uploadMessageFile(
  userId: string,
  file: { localId?: string; uri: string; name: string; mimeType: string },
  onProgress: (value: number) => void,
) {
  const source = Platform.OS === 'web'
    ? await (await fetch(file.uri)).blob()
    : new File(file.uri);
  const size = source.size;
  if (!size || size > 500 * 1024 * 1024) throw new Error('Choose a file up to 500 MB.');
  const fingerprint = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${userId}:${file.localId ?? file.uri}:${file.name}:${size}`,
  );
  const key = `k1.message-upload.${userId}.${fingerprint}`;
  let uploadId = await AsyncStorage.getItem(key);
  if (!uploadId) {
    uploadId = Crypto.randomUUID();
    await AsyncStorage.setItem(key, uploadId);
  }
  const session = await api<UploadSession>('/v1/media/message-uploads', {
    method: 'POST',
    body: JSON.stringify({ uploadId, name: file.name.slice(0, 180), type: file.mimeType, size }),
  });
  if (session.status === 'COMPLETE' && session.mediaId) {
    onProgress(1);
    await AsyncStorage.removeItem(key);
    return session.mediaId;
  }
  if (!Number.isInteger(session.chunkBytes) || session.chunkBytes < 1 || session.chunkBytes > 5 * 1024 * 1024) {
    throw new Error('This upload could not start. Try again.');
  }

  let handle: FileHandle | null = null;
  try {
    if (Platform.OS !== 'web') handle = (source as File).open(FileMode.ReadOnly);
    let sent = 0;
    const count = Math.ceil(size / session.chunkBytes);
    for (let part = 1; part <= count; part += 1) {
      const start = (part - 1) * session.chunkBytes;
      const partSize = Math.min(size, start + session.chunkBytes) - start;
      if (session.parts?.[String(part)]?.size === partSize) {
        sent += partSize;
        onProgress(sent / size);
        continue;
      }
      let bytes: ArrayBuffer;
      if (handle) {
        // File.slice() reads the entire native file through bytesSync(). A file
        // handle keeps memory bounded to this chunk, including for large videos.
        handle.offset = start;
        const chunk = handle.readBytes(partSize);
        if (chunk.byteLength !== partSize) throw new Error('The file changed while uploading. Choose it again.');
        bytes = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
      } else {
        bytes = await (source as Blob).slice(start, start + partSize).arrayBuffer();
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await api(`/v1/media/message-uploads/${session.id}/parts/${part}`, {
            method: 'PUT', body: bytes,
            headers: { 'Content-Type': 'application/octet-stream' }, timeoutMs: 120_000,
          });
          break;
        } catch (error) {
          if (attempt === 2) throw error;
        }
      }
      sent += partSize;
      onProgress(sent / size);
    }
    const result = await api<{ id: string }>(`/v1/media/message-uploads/${session.id}/complete`, { method: 'POST', timeoutMs: 60_000 });
    onProgress(1);
    await AsyncStorage.removeItem(key);
    return result.id;
  } finally {
    try { handle?.close(); } catch { /* The OS may already have closed the file. */ }
  }
}
