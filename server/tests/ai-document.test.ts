import {pdfFixture} from "./helpers/pdf";
import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
import { extractAIPdf } from '../src/lib/ai-document';
const fixture=(name:string)=>new Uint8Array(readFileSync(new URL('./fixtures/'+name,import.meta.url)));
describe('private PDF text extraction',()=>{
 it('extracts a real PDF and labels the source page',async()=>{expect(await extractAIPdf(fixture('ai-text.pdf'))).toContain('[Page 1]\nPhysics 101: Ohm law states V = I times R.');});
 it('rejects scans or blank PDFs clearly rather than inventing content',async()=>{await expect(extractAIPdf(fixture('ai-empty.pdf'))).rejects.toMatchObject({reason:'AI_SCANNED_PDF'});});
 it('rejects invalid file content',async()=>{await expect(extractAIPdf(new TextEncoder().encode('not a PDF'))).rejects.toMatchObject({reason:'AI_INVALID_PDF'});});
});

it('does not silently omit a scanned page inside a text PDF',async()=>{await expect(extractAIPdf(pdfFixture(['Readable timetable',null]))).rejects.toMatchObject({reason:'AI_SCANNED_PDF'});});
it('rejects documents beyond the page and text budget',async()=>{await expect(extractAIPdf(pdfFixture(Array.from({length:41},()=>"Timetable")))).rejects.toMatchObject({reason:'AI_DOCUMENT_TOO_LONG'});await expect(extractAIPdf(pdfFixture(Array.from({length:12},()=>"A".repeat(6000))))).rejects.toMatchObject({reason:'AI_DOCUMENT_TOO_LONG'});});
