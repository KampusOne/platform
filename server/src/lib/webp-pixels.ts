import decodeWebp, { init } from '@jsquash/webp/decode.js';
import decoder from '@jsquash/webp/codec/dec/webp_dec.wasm';
import { encode } from 'fast-png';
import type { AIMedia } from './ai-provider';

let ready:Promise<void>|undefined;
const maxPixels=4_000_000;
/** Inspect dimensions before allocating a WebP decoder's pixel buffer. */
export function webpDimensions(bytes:Uint8Array):{width:number;height:number}|undefined {
  const text=(offset:number,length:number)=>String.fromCharCode(...bytes.subarray(offset,offset+length));
  if(bytes.length<20||text(0,4)!=='RIFF'||text(8,4)!=='WEBP')return;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let offset=12;offset+8<=bytes.length;) {
    const kind=text(offset,4),length=view.getUint32(offset+4,true),start=offset+8;
    if(length>bytes.length-start)return;
    if(kind==='VP8X'&&length>=10) {
      if(bytes[start]!&2)return; // animated source needs a deliberate frame choice
      const u24=(n:number)=>bytes[n]!|(bytes[n+1]!<<8)|(bytes[n+2]!<<16);
      return {width:u24(start+4)+1,height:u24(start+7)+1};
    }
    if(kind==='VP8L'&&length>=5&&bytes[start]===0x2f) {
      const bits=view.getUint32(start+1,true);return {width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};
    }
    if(kind==='VP8 '&&length>=10&&bytes[start+3]===0x9d&&bytes[start+4]===1&&bytes[start+5]===0x2a)
      return {width:view.getUint16(start+6,true)&0x3fff,height:view.getUint16(start+8,true)&0x3fff};
    offset=start+length+(length&1);
  }
}
/** Keep the stored original; the same private pixels get a supported lossless
 * representation for deterministic border isolation, without a public URL. */
export async function prepareTimetableImage(media:AIMedia):Promise<AIMedia> {
  if(media.mimeType!=='image/webp')return media;
  try {
    const bytes=Uint8Array.from(atob(media.data),c=>c.charCodeAt(0)),size=webpDimensions(bytes);
    if(!size||size.width<1||size.height<1||size.width*size.height>maxPixels)return media;
    ready??=(init as unknown as (module:WebAssembly.Module)=>Promise<void>)(decoder);
    await ready;
    const pixels=await decodeWebp(bytes.buffer);
    if(pixels.width!==size.width||pixels.height!==size.height)return media;
    const encoded=encode({width:pixels.width,height:pixels.height,data:new Uint8Array(pixels.data.buffer,pixels.data.byteOffset,pixels.data.byteLength),channels:4,depth:8});
    let binary='';for(let i=0;i<encoded.length;i+=8192)binary+=String.fromCharCode(...encoded.subarray(i,i+8192));
    return {mimeType:'image/png',data:btoa(binary)};
  }catch{return media;}
}
