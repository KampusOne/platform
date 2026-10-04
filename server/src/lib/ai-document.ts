import { getDocumentProxy } from "unpdf";
import { AIProviderError, MAX_AI_MEDIA_BYTES } from "./ai-provider";
export const MAX_AI_DOCUMENT_CHARACTERS = 45000;
/** Decode normal editor exports, including Windows UTF-16 files with a BOM. */
export function decodeAIText(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > MAX_AI_MEDIA_BYTES) throw new AIProviderError(400,"AI_INVALID_TEXT","This text file is empty or too large.");
  const encoding=bytes[0]===0xff&&bytes[1]===0xfe?"utf-16le":bytes[0]===0xfe&&bytes[1]===0xff?"utf-16be":"utf-8";
  let text: string;
  try { text=new TextDecoder(encoding,{fatal:true}).decode(bytes).replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n").trim(); }
  catch { throw new AIProviderError(400,"AI_INVALID_TEXT","Save this text file as UTF-8 or UTF-16, or attach a PDF."); }
  if (!text || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new AIProviderError(400,"AI_INVALID_TEXT","This file does not contain readable plain text. Attach a TXT file or PDF.");
  if (text.length>MAX_AI_DOCUMENT_CHARACTERS) throw new AIProviderError(422,"AI_DOCUMENT_TOO_LONG","This text file contains too much material for one request. Upload a smaller section.");
  return text;
}
/** No URL fetching, document scripts or OCR. Scanned-only PDFs fail clearly. */
export async function extractAIPdf(bytes: Uint8Array): Promise<string> {
  if (!bytes.length || bytes.length > MAX_AI_MEDIA_BYTES || new TextDecoder().decode(bytes.subarray(0,5)) !== "%PDF-") throw new AIProviderError(400, "AI_INVALID_PDF", "This file is not a readable PDF.");
  let document: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    document = await getDocumentProxy(bytes, { useSystemFonts: false, disableAutoFetch: true, disableStream: true, stopAtErrors: true });
    if (document.numPages > 40) throw new AIProviderError(422, "AI_DOCUMENT_TOO_LONG", "Use a PDF of up to 40 pages, or upload one section at a time.");
    const pages: string[] = []; let length = 0, readablePages = 0;
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      const content = await page.getTextContent();
      const text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
      length += text.length;
      if (length > MAX_AI_DOCUMENT_CHARACTERS) throw new AIProviderError(422, "AI_DOCUMENT_TOO_LONG", "This PDF contains too much text for one request. Upload a smaller section.");
      // A blank cover/scan must not reject readable pages in the same PDF. Mark
      // the gap explicitly so neither the model nor the student can mistake it
      // for a complete extraction. Scanned-only sources still fail clearly.
      if (text) readablePages++;
      pages.push(`[Page ${n}]\n${text || "[No extractable text on this page. It may be blank or scanned. Do not infer its content; ask for this page as an image if it is needed.]"}`);
      page.cleanup();
    }
    if (!readablePages) throw new AIProviderError(422, "AI_SCANNED_PDF", "This PDF is a scan without readable text. Attach the relevant page as an image instead.");
    return pages.join("\n\n");
  } catch (error) {
    if (error instanceof AIProviderError) throw error;
    throw new AIProviderError(422, "AI_INVALID_PDF", "This PDF could not be read. Remove password protection or attach a page as an image.");
  } finally { await document?.loadingTask.destroy().catch(() => undefined); }
}
