import {createHash} from 'node:crypto';
import {createRemoteJWKSet,importJWK,jwtVerify,type JWTVerifyGetKey} from 'jose';
import sharp from 'sharp';
import {decode as jpeg} from 'jpeg-js';
import {decode as decodePng,encode as encodePng} from 'fast-png';
import {createTimetablePixels} from '../../packages/contracts/src/timetable-pixels';

const audience='kampusone:private:timetable-image',maxBody=4_200_000;
const remoteKeys=createRemoteJWKSet(new URL('https://platformp.divine-haze-54eb.workers.dev/health/image-processing-key'),{timeoutDuration:5000,cooldownDuration:60000});
// Verified public bootstrap key. Rotated keys are fetched only from the fixed
// trusted Worker origin, allowing deployment before its new key route is live.
export const bootstrapImageKey={kty:'OKP',crv:'Ed25519',x:'kYbDttFDfCnIkDcvqMSwvVrswEMGqstfCglZp5zDatA',alg:'EdDSA',use:'sig',kid:'image:kYbDttFDfCnIkDcv'};
const signingKey:JWTVerifyGetKey=async(header,token)=>{
  if(header.kid===bootstrapImageKey.kid)return importJWK(bootstrapImageKey,'EdDSA');
  return remoteKeys(header,token);
};
const pixels=createTimetablePixels({decodeJpeg:bytes=>jpeg(bytes,{useTArray:true,maxResolutionInMP:4,maxMemoryUsageInMB:48,tolerantDecoding:false}),decodePng,encodePng});

/** Pure private CPU work. No database, user authorization, AI calls or files. */
export async function privateTimetableImage(request:Request,getKey:JWTVerifyGetKey=signingKey) {
  const headers={'Cache-Control':'no-store'};
  let bodyHash:string;
  try {
    const authorization=request.headers.get('authorization');
    if(!authorization?.startsWith('Bearer ')||authorization.length>2048)return new Response(null,{status:401,headers});
    const {payload}=await jwtVerify(authorization.slice(7),getKey,{algorithms:['EdDSA'],issuer:'kampusone-worker',audience,maxTokenAge:'60s'});
    if(typeof payload.bodyHash!=='string'||!/^[a-f0-9]{64}$/.test(payload.bodyHash)||typeof payload.iat!=='number'||typeof payload.exp!=='number'||payload.exp-payload.iat>60||typeof payload.jti!=='string')return new Response(null,{status:401,headers});
    bodyHash=payload.bodyHash;
  } catch {return new Response(null,{status:401,headers});}
  try {
    if(Number(request.headers.get('content-length')??0)>maxBody)return new Response(null,{status:413,headers});
    const body=await request.text();
    if(Buffer.byteLength(body)>maxBody)return new Response(null,{status:413,headers});
    if(createHash('sha256').update(body).digest('hex')!==bodyHash)return new Response(null,{status:401,headers});
    const input=JSON.parse(body);
    if(!['layout','rows'].includes(input.operation)||!input.media||!['image/jpeg','image/png','image/webp'].includes(input.media.mimeType)||typeof input.media.data!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.media.data))return new Response(null,{status:400,headers});
    let media=input.media as {mimeType:string;data:string};
    const bytes=Buffer.from(media.data,'base64');
    const metadata=await sharp(bytes,{limitInputPixels:4_000_000,animated:false}).metadata();
    if(!metadata.width||!metadata.height||metadata.width*metadata.height>4_000_000||metadata.pages&&metadata.pages>1)return Response.json({},{headers});
    if(media.mimeType==='image/webp')media={mimeType:'image/png',data:(await sharp(bytes,{limitInputPixels:4_000_000}).ensureAlpha().png().toBuffer()).toString('base64')};
    let result;
    if(input.operation==='layout')result={layout:pixels.timetableLayoutImage(media)};
    else {
      if(!Number.isInteger(input.timeColumnCount)||input.timeColumnCount<1||input.timeColumnCount>24||!Array.isArray(input.levels)||input.levels.length<2||input.levels.length>20||input.levels.some((x:unknown)=>typeof x!=='string'||!/^[0-9]{3}$/.test(x))||!Array.isArray(input.days)||input.days.length<1||input.days.length>7||input.days.some((x:unknown)=>typeof x!=='number'||!Number.isInteger(x)||x<0||x>6)||typeof input.selectedLevel!=='string')return new Response(null,{status:400,headers});
      result={rows:pixels.timetableImageRows(media,input.timeColumnCount,input.levels,input.days,input.selectedLevel)};
    }
    const output=JSON.stringify(result);
    if(Buffer.byteLength(output)>maxBody)return Response.json({},{headers});
    return new Response(output,{headers:{...headers,'Content-Type':'application/json'}});
  } catch {
    // Malformed/unsupported pixels are an optional geometry miss. The Worker
    // retains the original and applies its full-week validation before import.
    console.warn(JSON.stringify({event:'timetable.image.geometry_unavailable'}));
    return Response.json({},{headers});
  }
}
