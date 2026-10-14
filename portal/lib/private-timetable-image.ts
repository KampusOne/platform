import {createHash} from 'node:crypto';
import {createRemoteJWKSet,importJWK,jwtVerify,type JWTVerifyGetKey} from 'jose';
import sharp from 'sharp';
import {decode as jpeg} from 'jpeg-js';
import {decode as decodePng,encode as encodePng} from 'fast-png';
import {createTimetablePixels} from '../../packages/contracts/src/timetable-pixels';
import type {TimetableImageRow} from '../../packages/contracts/src/timetable-pixels';

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

export async function rowAtlas(rows:TimetableImageRow[]) {
  if(!rows.length||rows.length>7)return;
  const strips=await Promise.all(rows.map(async row=>{
    const bytes=Buffer.from(row.media.data,'base64'),meta=await sharp(bytes,{limitInputPixels:4_000_000}).metadata();
    const panelHeight=meta.height!/(row.cells.length+1);
    if(!Number.isInteger(panelHeight))throw new Error('Invalid panel geometry');
    const panels=await Promise.all(Array.from({length:row.cells.length+1},async(_,i)=>{
      const isolated=await sharp(bytes).extract({left:0,top:i*panelHeight,width:meta.width!,height:panelHeight-2}).png().toBuffer();
      return sharp(isolated).flatten({background:'white'}).trim({background:'white',threshold:16}).extend({top:8,bottom:8,left:8,right:8,background:'white'}).png().toBuffer();
    }));
    const sizes=await Promise.all(panels.map(p=>sharp(p).metadata()));
    const columns=3,tileWidth=Math.max(...sizes.map(m=>m.width!))+12,tileHeight=Math.max(...sizes.map(m=>m.height!))+12;
    const width=columns*tileWidth,height=44+Math.ceil(panels.length/columns)*tileHeight;
    const header=Buffer.from(`<svg width="${width}" height="44"><rect width="100%" height="100%" fill="white"/><text x="8" y="31" font-size="28" font-family="sans-serif" font-weight="bold">DAY ${row.day}</text></svg>`);
    const data=await sharp({create:{width,height,channels:3,background:'white'}}).composite([{input:header,left:0,top:0},...panels.map((input,i)=>({input,left:i%columns*tileWidth,top:44+Math.floor(i/columns)*tileHeight}))]).png().toBuffer();
    return{data,width,height};
  }));
  const width=Math.max(...strips.map(s=>s.width)),height=strips.reduce((sum,s)=>sum+s.height+20,0);
  if(width*height>24_000_000)return;
  let top=0;const overlays=strips.map(s=>{const item={input:s.data,left:0,top};top+=s.height+20;return item;});
  const scale=Math.min(1,Math.sqrt(3_900_000/(width*height)));
  const combined=await sharp({create:{width,height,channels:3,background:'white'}}).composite(overlays).png().toBuffer();
  const data=await sharp(combined).resize(Math.floor(width*scale),Math.floor(height*scale)).png().toBuffer();
  if(data.length>2_900_000)return;
  return{mimeType:'image/png',data:data.toString('base64')};
}

/** Detect a ruled page's horizontal line angle, then verify its actual borders. */
export async function deskewTimetable(bytes:Buffer) {
  const {data,info}=await sharp(bytes,{limitInputPixels:4_000_000}).resize({width:800,withoutEnlargement:true}).flatten({background:'white'}).greyscale().raw().toBuffer({resolveWithObject:true});
  const points:number[]=[];
  for(let y=0;y<info.height;y++)for(let x=Math.ceil(info.width*.1);x<info.width*.98;x++)if(data[y*info.width+x]!<170)points.push(x,y);
  let bestAngle=0,bestScore=0;
  for(let step=-24;step<=24;step++){
    const angle=step/4,slope=Math.tan(angle*Math.PI/180),bins=new Uint32Array(info.height+160);
    for(let i=0;i<points.length;i+=2){const at=Math.round(points[i+1]!-slope*(points[i]!-info.width/2))+80;if(at>=0&&at<bins.length)bins[at]++;}
    const peaks=Array.from(bins).filter(n=>n>info.width*.4).sort((a,b)=>b-a).slice(0,32);
    const score=peaks.length>=12?peaks.reduce((sum,n)=>sum+n*n,0):0;
    if(score>bestScore){bestScore=score;bestAngle=angle;}
  }
  if(!bestScore||Math.abs(bestAngle)<.25)return;
  const png=await sharp(bytes,{limitInputPixels:4_000_000}).rotate(-bestAngle,{background:'white'}).resize({width:1900,height:1900,fit:'inside',withoutEnlargement:true}).ensureAlpha().png().toBuffer();
  const media={mimeType:'image/png',data:png.toString('base64')};
  return pixels.timetableLayoutImage(media)?media:undefined;
}

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
    if(!pixels.timetableLayoutImage(media)){const straight=await deskewTimetable(bytes);if(straight)media=straight;}
    let result;
    if(input.operation==='layout')result={layout:pixels.timetableLayoutImage(media)};
    else {
      if(!Number.isInteger(input.timeColumnCount)||input.timeColumnCount<1||input.timeColumnCount>24||!Array.isArray(input.levels)||input.levels.length<2||input.levels.length>20||input.levels.some((x:unknown)=>typeof x!=='string'||!/^[0-9]{3}$/.test(x))||!Array.isArray(input.days)||input.days.length<1||input.days.length>7||input.days.some((x:unknown)=>typeof x!=='number'||!Number.isInteger(x)||x<0||x>6)||typeof input.selectedLevel!=='string')return new Response(null,{status:400,headers});
      const rows=pixels.timetableImageRows(media,input.timeColumnCount,input.levels,input.days,input.selectedLevel);
      result={rows,...(rows&&input.batch===true?{batch:await rowAtlas(rows).catch(()=>undefined)}:{})};
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
