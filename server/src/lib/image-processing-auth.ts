import { SignJWT } from 'jose';

export const imageProcessingAudience='kampusone:private:timetable-image';
export const academicInferenceAudience='kampusone:private:academic-inference';
const encoder=new TextEncoder();
let signingKey:Promise<CryptoKey>|undefined;
let keySource:string|undefined;
function imageKey(secret:string) {
  if(!secret||secret.length<32)throw new Error('Image authentication is not configured.');
  if(keySource!==secret) {
    keySource=secret;
    signingKey=(async()=>{
      const material=await crypto.subtle.importKey('raw',encoder.encode(secret),'HKDF',false,['deriveBits']);
      const seed=new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:encoder.encode('kampusone:service-keys:v1'),info:encoder.encode(imageProcessingAudience)},material,256));
      // RFC 8410 PKCS#8 wrapping of a 32-byte Ed25519 seed. The service key
      // is domain-separated from session tokens and never leaves the Worker.
      const prefix=Uint8Array.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
      const pkcs8=new Uint8Array(prefix.length+seed.length);pkcs8.set(prefix);pkcs8.set(seed,prefix.length);
      return crypto.subtle.importKey('pkcs8',pkcs8,{name:'Ed25519'},true,['sign']);
    })();
  }
  return signingKey!;
}
export async function imageProcessingPublicKey(secret:string) {
  const jwk=await crypto.subtle.exportKey('jwk',await imageKey(secret));
  return {kty:'OKP',crv:'Ed25519',x:jwk.x!,alg:'EdDSA',use:'sig',kid:'image:'+jwk.x!.slice(0,16)};
}
export async function imageProcessingToken(secret:string,body:string,audience:typeof imageProcessingAudience|typeof academicInferenceAudience=imageProcessingAudience) {
  const key=await imageKey(secret),jwk=await imageProcessingPublicKey(secret);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(body)));
  const bodyHash=Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('');
  return new SignJWT({bodyHash}).setProtectedHeader({alg:'EdDSA',typ:'JWT',kid:jwk.kid})
    .setIssuer('kampusone-worker').setAudience(audience)
    .setIssuedAt().setExpirationTime('60s').setJti(crypto.randomUUID()).sign(key);
}
