import { describe,expect,it,vi } from 'vitest';
import { nativeKiraVoiceBody,MAX_KIRA_VOICE_BYTES } from '../../mobile/src/lib/kira-voice-upload';
describe('native Kira voice transport',()=>{
 it('converts an Expo-like file host object to RN fetch ArrayBuffer bytes',async()=>{const bytes=new Uint8Array([1,2,3,4]).buffer;const file={exists:true,size:4,arrayBuffer:vi.fn().mockResolvedValue(bytes),nativeSharedObjectId:123};const body=await nativeKiraVoiceBody(file);expect(body).toBe(bytes);expect(body).toBeInstanceOf(ArrayBuffer);expect(body).not.toBe(file);expect(file.arrayBuffer).toHaveBeenCalledTimes(1);});
 it('rejects unavailable or oversized recordings before reading bytes',async()=>{for(const properties of [{exists:false,size:4},{exists:true,size:MAX_KIRA_VOICE_BYTES+1},{exists:true,size:NaN}]){const file={...properties,arrayBuffer:vi.fn()};await expect(nativeKiraVoiceBody(file)).rejects.toThrow();expect(file.arrayBuffer).not.toHaveBeenCalled();}});
 it('rejects a host object returned in place of bytes, empty data or lying size metadata',async()=>{for(const body of [{nativeSharedObjectId:123,size:4},new ArrayBuffer(0),new ArrayBuffer(MAX_KIRA_VOICE_BYTES+1)])await expect(nativeKiraVoiceBody({exists:true,size:4,arrayBuffer:vi.fn().mockResolvedValue(body)})).rejects.toThrow();});
});
