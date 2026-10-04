export const MAX_KIRA_VOICE_BYTES=8*1024*1024;
type NativeRecordingFile={readonly exists:boolean;readonly size:number;arrayBuffer:()=>Promise<ArrayBuffer>};
/** RN global fetch accepts ArrayBuffer bytes; it does not accept an Expo File host object. */
export async function nativeKiraVoiceBody(file:NativeRecordingFile):Promise<ArrayBuffer> {
  if(!file.exists)throw new Error('The recording could not be read. Record it again.');
  if(!Number.isFinite(file.size)||file.size<0)throw new Error('The recording size could not be read. Record it again.');
  if(file.size>MAX_KIRA_VOICE_BYTES)throw new Error('Record a shorter voice message.');
  const body=await file.arrayBuffer();
  if(!(body instanceof ArrayBuffer))throw new Error('The recording could not be read. Record it again.');
  if(!body.byteLength)throw new Error('This recording is empty. Record it again.');
  if(body.byteLength>MAX_KIRA_VOICE_BYTES)throw new Error('Record a shorter voice message.');
  return body;
}
