import {pdfFixture} from "./helpers/pdf";
import { readFileSync } from 'node:fs';
import { describe,expect,it,vi } from 'vitest';
import { extractAIPdf } from '../src/lib/ai-document';
const fixture=(name:string)=>new Uint8Array(readFileSync(new URL('./fixtures/'+name,import.meta.url)));
describe('private PDF text extraction',()=>{
 it('extracts a real PDF and labels the source page',async()=>{expect(await extractAIPdf(fixture('ai-text.pdf'))).toContain('[Page 1]\nPhysics 101: Ohm law states V = I times R.');});
 it('rejects scans or blank PDFs clearly rather than inventing content',async()=>{await expect(extractAIPdf(fixture('ai-empty.pdf'))).rejects.toMatchObject({reason:'AI_SCANNED_PDF'});});
 it('rejects invalid file content',async()=>{await expect(extractAIPdf(new TextEncoder().encode('not a PDF'))).rejects.toMatchObject({reason:'AI_INVALID_PDF'});});
});

it('does not silently omit a scanned page inside a text PDF',async()=>{await expect(extractAIPdf(pdfFixture(['Readable timetable',null]))).rejects.toMatchObject({reason:'AI_SCANNED_PDF'});});
it('reads hundreds of pages without the former 40-page ceiling',async()=>{const source=await extractAIPdf(pdfFixture(Array.from({length:200},(_,i)=>`Chapter ${i+1}: useful study content.`)));expect(source).toContain('[Page 200]');});
it('enforces the documented resource ceiling without silently truncating',async()=>{await expect(extractAIPdf(pdfFixture(Array.from({length:1001},()=>"Timetable")))).rejects.toMatchObject({reason:'AI_DOCUMENT_TOO_LONG'});await expect(extractAIPdf(pdfFixture(Array.from({length:200},()=>"A".repeat(4000))))).rejects.toMatchObject({reason:'AI_DOCUMENT_TOO_LONG'});});

it('retrieves source details beyond the initial section with page provenance',async()=>{
 const {documentContext}=await import('../src/lib/ai-document');
 const source='[Page 1]\n'+('Introduction to electricity. '.repeat(2200))+'\n[Page 42]\nKirchhoff current law: currents entering a junction sum to currents leaving it.';
 const context=documentContext(source,'Explain Kirchhoff current law');expect(context).toContain('[Page 42]');expect(context).toContain('currents entering');expect(context.length).toBeLessThan(16500);
});
it('encodes extracted raster bytes as a valid lossless PNG for Worker OCR',async()=>{
 const {rasterPNG}=await import('../src/lib/ai-document');const {inflateSync}=await import('node:zlib');
 const bytes=await rasterPNG({width:2,height:1,channels:3,data:new Uint8ClampedArray([255,0,0,0,255,0])});
 expect([...bytes.slice(0,8)]).toEqual([137,80,78,71,13,10,26,10]);const view=new DataView(bytes.buffer);
 expect(view.getUint32(16)).toBe(2);expect(view.getUint32(20)).toBe(1);
 const compressed=bytes.slice(41,41+view.getUint32(33));expect([...inflateSync(compressed)]).toEqual([0,255,0,0,0,255,0]);
});

it('extracts a real scanned page and transcribes it only in the reserved completion step',async()=>{
 const {prepareAIPdf,completeAIPdf}=await import('../src/lib/ai-document');const {scannedPdfFixture}=await import('./helpers/pdf');
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({readable:true,text:'Scanned source transcription'})}}]}),{headers:{'Content-Type':'application/json'}}));
 vi.stubGlobal('fetch',fetcher);
 try {const prepared=await prepareAIPdf(scannedPdfFixture());expect(prepared.ocrCalls).toBe(1);expect(fetcher).not.toHaveBeenCalled();
 const text=await completeAIPdf(prepared,{AI_ASSISTANT_ENABLED:'true',HF_TOKEN:'test',HF_CHAT_MODEL:'test',HF_VISION_MODEL:'test'});expect(text).toBe('[Page 1]\nScanned source transcription');expect(fetcher).toHaveBeenCalledTimes(1);
 }finally{vi.unstubAllGlobals();}
});
