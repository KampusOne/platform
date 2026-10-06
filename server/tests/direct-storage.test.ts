import {afterEach,describe,expect,it,vi} from 'vitest';
import {signedUploadPart,signedPlayback,listUploadParts,parseStorageParts} from '../src/lib/direct-storage';
import {storageConfig,validateStorageEnv} from '../src/lib/storage-env';
import type {Bindings} from '../src/types';
const env={R2_DIRECT_UPLOADS_ENABLED:'true',R2_ACCOUNT_ID:'a'.repeat(32),R2_ACCESS_KEY_ID:'fixture-access-key-id',R2_SECRET_ACCESS_KEY:'fixture-secret-do-not-expose-1234567890',R2_PRIVATE_BUCKET_NAME:'kampusone-private',R2_MEDIA_BUCKET_NAME:'kampusone-media',PRIVATE_BUCKET:{}} as Bindings;
afterEach(()=>vi.unstubAllGlobals());
describe('Presigned storage adapter',()=>{
 it('signs only the reserved upload ID, part, operation and short expiry',async()=>{
  const signed=await signedUploadPart(env,'message/user/file','multipart-fixture',2,5242880),url=new URL(signed.url);
  expect(url.hostname).toBe('a'.repeat(32)+'.r2.cloudflarestorage.com');expect(url.pathname).toBe('/kampusone-private/message/user/file');
  expect(url.searchParams.get('uploadId')).toBe('multipart-fixture');expect(url.searchParams.get('partNumber')).toBe('2');
  expect(url.searchParams.get('X-Amz-Expires')).toBe('600');expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
  expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);expect(signed.url).not.toContain(env.R2_SECRET_ACCESS_KEY);
 });
 it('signs authorized playback in the correct bucket and rejects arbitrary object paths',async()=>{
  const result=await signedPlayback(env,{object_key:'resource/a/video',content_type:'video/mp4',private:true});
  const url=new URL(result.url);expect(url.pathname).toBe('/kampusone-private/resource/a/video');expect(url.searchParams.get('response-content-disposition')).toBe('inline');
  await expect(signedPlayback(env,{object_key:'../secret',content_type:'video/mp4',private:true})).rejects.toThrow('Invalid storage object');
 });
 it('validates real R2 size/ETag receipts instead of a browser claim',async()=>{
  const xml='<ListPartsResult><IsTruncated>false</IsTruncated><Part><PartNumber>2</PartNumber><ETag>&quot;'+ 'b'.repeat(32)+'&quot;</ETag><Size>200</Size></Part><Part><PartNumber>1</PartNumber><ETag>"'+'a'.repeat(32)+'"</ETag><Size>5242880</Size></Part></ListPartsResult>';
  expect(parseStorageParts(xml)).toEqual([{partNumber:1,etag:'a'.repeat(32),size:5242880},{partNumber:2,etag:'b'.repeat(32),size:200}]);
  const fetch=vi.fn(async()=>new Response(xml));vi.stubGlobal('fetch',fetch);
  expect(await listUploadParts(env,'message/user/file','multipart-fixture')).toHaveLength(2);
  const request=fetch.mock.calls[0]![0] as unknown as Request;expect(request.headers.get('Authorization')).toMatch(/^AWS4-HMAC-SHA256 /);
  expect(()=>parseStorageParts(xml.replace('false','true'))).toThrow();expect(()=>parseStorageParts('<Error/>')).toThrow();
 });
 it('fails configuration before request work without leaking a secret rejected by Yup',()=>{
  const secret='SENSITIVE-SECRET';expect(()=>storageConfig({...env,R2_SECRET_ACCESS_KEY:secret,R2_ACCOUNT_ID:'invalid'})).toThrow('R2_SECRET_ACCESS_KEY');
  try{storageConfig({...env,R2_SECRET_ACCESS_KEY:secret});}catch(error){expect(String(error)).not.toContain(secret);}
  expect(()=>validateStorageEnv({...env,R2_DIRECT_UPLOADS_ENABLED:'false',R2_SECRET_ACCESS_KEY:undefined} as Bindings)).not.toThrow();
  expect(()=>validateStorageEnv({...env,R2_DIRECT_UPLOADS_ENABLED:'yes'})).toThrow('must be true or false');
 });
});
