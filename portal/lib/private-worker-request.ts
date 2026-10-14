import {createHash} from 'node:crypto';
import {createRemoteJWKSet,importJWK,jwtVerify,type JWTVerifyGetKey} from 'jose';

export const bootstrapImageKey={kty:'OKP',crv:'Ed25519',x:'kYbDttFDfCnIkDcvqMSwvVrswEMGqstfCglZp5zDatA',alg:'EdDSA',use:'sig',kid:'image:kYbDttFDfCnIkDcv'};
const remoteKeys=createRemoteJWKSet(new URL('https://platformp.divine-haze-54eb.workers.dev/health/image-processing-key'),{timeoutDuration:5000,cooldownDuration:60000});
export const workerSigningKey:JWTVerifyGetKey=async(header,token)=>header.kid===bootstrapImageKey.kid
  ?importJWK(bootstrapImageKey,'EdDSA'):remoteKeys(header,token);

/** Only the trusted Worker can authorize an exact private request body. */
export async function privateWorkerBody(request:Request,audience:string,maxBody:number,getKey:JWTVerifyGetKey=workerSigningKey):Promise<string|Response> {
  const headers={'Cache-Control':'no-store'};
  let bodyHash:string;
  try {
    const authorization=request.headers.get('authorization');
    if(!authorization?.startsWith('Bearer ')||authorization.length>2048)return new Response(null,{status:401,headers});
    const {payload}=await jwtVerify(authorization.slice(7),getKey,{algorithms:['EdDSA'],issuer:'kampusone-worker',audience,maxTokenAge:'60s'});
    if(typeof payload.bodyHash!=='string'||!/^[a-f0-9]{64}$/.test(payload.bodyHash)||typeof payload.iat!=='number'||typeof payload.exp!=='number'||payload.exp-payload.iat>60||typeof payload.jti!=='string')return new Response(null,{status:401,headers});
    bodyHash=payload.bodyHash;
  } catch {return new Response(null,{status:401,headers});}
  if(Number(request.headers.get('content-length')??0)>maxBody)return new Response(null,{status:413,headers});
  const chunks:Uint8Array[]=[];let size=0;
  const reader=request.body?.getReader();
  if(reader)try {
    for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;
      if(size>maxBody){await reader.cancel();return new Response(null,{status:413,headers});}chunks.push(value);}
  }catch{return new Response(null,{status:400,headers});}finally{reader.releaseLock();}
  const body=Buffer.concat(chunks).toString('utf8');
  if(createHash('sha256').update(body).digest('hex')!==bodyHash)return new Response(null,{status:401,headers});
  return body;
}
