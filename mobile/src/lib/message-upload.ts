import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { File, FileMode, type FileHandle } from 'expo-file-system';
import { api } from './api';
import {withRequestDeadline} from './request-deadline';

type UploadSession = {
  id: string;
  parts: Record<string, { size: number }>;
  status: string;
  mediaId: string | null;
  chunkBytes: number;
  transport?: "proxy"|"direct";
};

export async function uploadMessageFile(
  userId: string,
  file: { localId?: string; uri: string; name: string; mimeType: string },
  onProgress: (value: number) => void,
  kind: 'message' | 'resource' | 'tutorial' | 'post' = 'message',
  suppliedUploadId?:string,
) {
  const source = Platform.OS === 'web'
    ? await (await fetch(file.uri)).blob()
    : new File(file.uri);
  const size = source.size;
  const limit=(kind==='post'?50:kind==='resource'?100:500)*1024*1024;
  if (!size || size > limit) throw new Error(`Choose a file up to ${limit/1024/1024} MB. Compress larger files before attaching them.`);
  const fingerprint = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${kind}:${userId}:${file.localId ?? file.uri}:${file.name}:${size}`,
  );
  const key = `k1.message-upload.${userId}.${fingerprint}`;
  let uploadId = suppliedUploadId??await AsyncStorage.getItem(key);
  if (!uploadId) {
    uploadId = Crypto.randomUUID();
    await AsyncStorage.setItem(key, uploadId);
  }
  const session = await api<UploadSession>('/v1/media/message-uploads', {
    method: 'POST',
    body: JSON.stringify({ uploadId, name: file.name.slice(0, 180), type: file.mimeType, size,kind }),
  });
  if (session.status === 'COMPLETE' && session.mediaId) {
    onProgress(1);
    if(kind==='message'||kind==='post')await AsyncStorage.removeItem(key);
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
          if(session.transport==='direct'){
            const signed=await api<{url:string;headers:Record<string,string>}>(`/v1/media/message-uploads/${session.id}/parts/${part}/url`,{method:'POST'});
            const url=new URL(signed.url);
            if(url.protocol!=='https:'||!/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/i.test(url.hostname)||url.username||url.password||url.port)throw new Error('Storage returned an invalid upload address.');
            const response=await withRequestDeadline(signal=>fetch(signed.url,{method:'PUT',body:bytes,headers:signed.headers,signal}),120_000);
            if(!response.ok)throw new Error('Storage could not receive this chunk. Retry to resume.');
            await api(`/v1/media/message-uploads/${session.id}/parts/${part}/confirm`,{method:'POST'});
          }else{
            await api(`/v1/media/message-uploads/${session.id}/parts/${part}`,{method:'PUT',body:bytes,headers:{'Content-Type':'application/octet-stream'},timeoutMs:120_000});
          }
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
    if(kind==='message'||kind==='post')await AsyncStorage.removeItem(key);
    return result.id;
  } finally {
    try { handle?.close(); } catch { /* The OS may already have closed the file. */ }
  }
}
