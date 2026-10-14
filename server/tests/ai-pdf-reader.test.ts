import {readFileSync} from 'node:fs';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {readPrivateAIPdf,scanImagePng} from '../src/lib/ai-pdf-reader';
import {scannedPdfFixture,pdfFixture} from './helpers/pdf';

const fixture=JSON.parse(readFileSync(new URL('../../scripts/fixtures/handwritten-timetable.json',import.meta.url),'utf8'));
const jpeg=Uint8Array.from(Buffer.from(fixture.jpegBase64,'base64'));
const pdf=(pages:(string|null)[]=[null])=>scannedPdfFixture(jpeg,fixture.width,fixture.height,pages);
afterEach(()=>vi.unstubAllGlobals());
describe('private scan PDF reading',()=>{
  it('encodes RGB and alpha scan pixels in a PNG accepted by a real decompressor',async()=>{
    for(const channels of [1,3,4]){
      const data=Uint8ClampedArray.from({length:2*2*channels},(_,i)=>i*7),png=await scanImagePng({width:2,height:2,channels,data});
      expect([...png.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
      const view=new DataView(png.buffer);expect(view.getUint32(16)).toBe(2);expect(view.getUint32(20)).toBe(2);
      const idatLength=view.getUint32(33),compressed=png.slice(41,41+idatLength);
      const raw=new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
      expect([...raw.subarray(1,1+2*channels),...raw.subarray(2+2*channels)]).toEqual([...data]);
    }
  });
  it('decodes an embedded JPEG PDF and transcribes private pixels, preserving source bytes',async()=>{
    const bytes=pdf(),before=bytes.slice(),run=vi.fn().mockResolvedValue({response:'MAT 101\n8:00 - 9:00\nLT 1'}),progress=vi.fn().mockResolvedValue(undefined);
    expect(await readPrivateAIPdf({AI:{run}},bytes,{onProgress:progress})).toContain('[Page 1]\nMAT 101');
    expect(bytes).toEqual(before);expect(run).toHaveBeenCalledTimes(1);expect(progress).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toBe('@cf/google/gemma-4-26b-a4b-it');
    const content=run.mock.calls[0]![1].messages[1].content;
    expect(content[1].image_url.url).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(content[1].image_url.url).not.toMatch(/https?:/);
  });
  it('reads native-text and scanned pages in order, and retains an explicitly blank page',async()=>{
    const run=vi.fn().mockResolvedValue({choices:[{finish_reason:'stop',message:{content:'Handwritten class: MAT 101 8:00 - 9:00'}}]});
    const result=await readPrivateAIPdf({AI:{run}},pdf(['Printed introduction',null]));
    expect(result).toMatch(/\[Page 1\]\nPrinted introduction[\s\S]*\[Page 2\]\nHandwritten class/);
    expect(run).toHaveBeenCalledTimes(1);
    const blank=await readPrivateAIPdf({AI:{run}},pdfFixture(['Readable text','']));
    expect(blank).toContain('[No extractable text on this page.');expect(run).toHaveBeenCalledTimes(1);
  });
  it('keeps provider failures and truncated transcriptions out of the final document',async()=>{
    await expect(readPrivateAIPdf({AI:{run:vi.fn().mockRejectedValue(Error('PRIVATE_PROVIDER_BODY'))}},pdf())).rejects.toMatchObject({reason:'AI_DOCUMENT_READER_UNAVAILABLE'});
    const run=vi.fn().mockResolvedValue({choices:[{finish_reason:'length',message:{content:'Half a page'}}]});
    await expect(readPrivateAIPdf({AI:{run}},pdf())).rejects.toMatchObject({reason:'AI_DOCUMENT_TOO_LONG'});
    await expect(readPrivateAIPdf({},pdf())).rejects.toMatchObject({reason:'AI_DOCUMENT_READER_UNAVAILABLE'});
  });
  it('reads an owned scan through the private fallback after native capacity is exhausted',async()=>{
    const bytes=pdf(),before=bytes.slice(),calls=vi.fn<typeof fetch>().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'MAT 101\n8:00 - 9:00\nLT 1',complete:true,uncertain:[]})}}]}));vi.stubGlobal('fetch',calls);
    const env={AI_ASSISTANT_ENABLED:'true',JWT_SECRET:'private-scan-test-secret-'.repeat(3),TIMETABLE_IMAGE_PROCESSOR_URL:'https://agents.kampusone.app/internal-processing/timetable-image',AI:{run:vi.fn().mockRejectedValue(new Error('4006 daily allocation'))}};
    expect(await readPrivateAIPdf(env,bytes)).toContain('[Page 1]\nMAT 101');expect(bytes).toEqual(before);expect(calls).toHaveBeenCalledTimes(1);
    expect(calls.mock.calls[0]![0]).toBe('https://agents.kampusone.app/internal-processing/academic-inference');
    calls.mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'Half a page',complete:false,uncertain:['rest unreadable']})}}]}));
    await expect(readPrivateAIPdf(env,bytes)).rejects.toMatchObject({reason:'AI_UNREADABLE_DOCUMENT'});
  });
  it('bounds scan count, oversized pixel declarations and an unresponsive vision call',async()=>{
    const run=vi.fn().mockResolvedValue({response:'A scanned page'});
    await expect(readPrivateAIPdf({AI:{run}},pdf(Array(9).fill(null)))).rejects.toMatchObject({reason:'AI_DOCUMENT_TOO_LONG'});
    expect(run).toHaveBeenCalledTimes(8);
    await expect(scanImagePng({width:10000,height:10000,channels:4,data:new Uint8ClampedArray(0)})).rejects.toMatchObject({reason:'AI_DOCUMENT_TOO_LONG'});
    await expect(readPrivateAIPdf({AI:{run:()=>new Promise(()=>{})}},pdf(),{timeoutMs:100})).rejects.toMatchObject({reason:'AI_TIMEOUT'});
  });
});
