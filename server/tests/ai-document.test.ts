import {pdfFixture} from "./helpers/pdf";
import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
import { extractAIPdf, decodeAIText } from '../src/lib/ai-document';
const fixture=(name:string)=>new Uint8Array(readFileSync(new URL('./fixtures/'+name,import.meta.url)));
describe('private PDF text extraction',()=>{
 it('extracts a real PDF and labels the source page',async()=>{expect(await extractAIPdf(fixture('ai-text.pdf'))).toContain('[Page 1]\nPhysics 101: Ohm law states V = I times R.');});
 it('rejects scans or blank PDFs clearly rather than inventing content',async()=>{await expect(extractAIPdf(fixture('ai-empty.pdf'))).rejects.toMatchObject({reason:'AI_SCANNED_PDF'});});
 it('rejects invalid file content',async()=>{await expect(extractAIPdf(new TextEncoder().encode('not a PDF'))).rejects.toMatchObject({reason:'AI_INVALID_PDF'});});
});

it('processes readable pages and explicitly marks unreadable pages inside a PDF',async()=>{const text=await extractAIPdf(pdfFixture(['Readable timetable',null]));expect(text).toContain('Readable timetable');expect(text).toContain('[Page 2]\n[No extractable text');expect(text).toContain('Do not infer its content');});
it('rejects documents beyond the page and text budget',async()=>{await expect(extractAIPdf(pdfFixture(Array.from({length:41},()=>"Timetable")))).rejects.toMatchObject({reason:'AI_DOCUMENT_TOO_LONG'});await expect(extractAIPdf(pdfFixture(Array.from({length:12},()=>"A".repeat(6000))))).rejects.toMatchObject({reason:'AI_DOCUMENT_TOO_LONG'});});

describe('private plain-text decoding',()=>{
 it('decodes UTF-8 and normalises editor line endings',()=>{expect(decodeAIText(new TextEncoder().encode('\uFEFFPhysics\r\nV = IR\rQuestions'))).toBe('Physics\nV = IR\nQuestions');});
 it.each(['le','be'])('reads BOM-marked UTF-16 %s text',order=>{const text='Physics: V = IR';const bytes=new Uint8Array(2+text.length*2);bytes.set(order==='le'?[255,254]:[254,255]);for(let i=0;i<text.length;i++){bytes[2+i*2+(order==='le'?0:1)]=text.charCodeAt(i);}expect(decodeAIText(bytes)).toBe(text);});
 it('rejects binary, unreadable, empty and overlong sources before inference',()=>{for(const bytes of [new Uint8Array(),new Uint8Array([0,1,2]),new Uint8Array([255,42,254])])expect(()=>decodeAIText(bytes)).toThrow();expect(()=>decodeAIText(new TextEncoder().encode('A'.repeat(45001)))).toThrow('smaller section');});
});
