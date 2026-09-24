import { getDocumentProxy } from "unpdf";
import { AIProviderError, MAX_AI_MEDIA_BYTES } from "./ai-provider";
/** No URL fetching, document scripts or OCR. Scanned-only PDFs fail clearly. */
export async function extractAIPdf(bytes: Uint8Array): Promise<string> {
  if (!bytes.length || bytes.length > MAX_AI_MEDIA_BYTES || new TextDecoder().decode(bytes.subarray(0,5)) !== "%PDF-") throw new AIProviderError(400, "AI_INVALID_PDF", "This file is not a readable PDF.");
  let document: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    document = await getDocumentProxy(bytes, { useSystemFonts: false, disableAutoFetch: true, disableStream: true });
    if (document.numPages > 40) throw new AIProviderError(422, "AI_DOCUMENT_TOO_LONG", "Use a PDF of up to 40 pages, or upload one section at a time.");
    const pages: string[] = []; let length = 0;
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      const content = await page.getTextContent();
      const text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
      length += text.length;
      if (length > 45000) throw new AIProviderError(422, "AI_DOCUMENT_TOO_LONG", "This PDF contains too much text for one request. Upload a smaller section.");
      if (text) pages.push(`[Page ${n}]\n${text}`);
      page.cleanup();
    }
    if (!pages.length) throw new AIProviderError(422, "AI_SCANNED_PDF", "This PDF is a scan without readable text. Attach the relevant page as an image instead.");
    return pages.join("\n\n");
  } catch (error) {
    if (error instanceof AIProviderError) throw error;
    throw new AIProviderError(422, "AI_INVALID_PDF", "This PDF could not be read. Remove password protection or attach a page as an image.");
  } finally { await document?.loadingTask.destroy().catch(() => undefined); }
}
