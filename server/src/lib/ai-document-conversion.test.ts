import { describe, expect, it, vi } from 'vitest';
import { convertAIFile } from './ai-document-conversion';
describe('private scanned-document conversion', () => {
  it('passes private bytes directly, without a public URL or mutating the source', async () => {
    const bytes=new TextEncoder().encode('PRIVATE_PDF'),toMarkdown=vi.fn().mockResolvedValue([{format:'markdown',data:'  A readable document  '}]);
    expect(await convertAIFile({run:vi.fn(),toMarkdown},bytes,'scan.pdf','application/pdf')).toBe('A readable document');
    const files=toMarkdown.mock.calls[0]![0];expect(files).toHaveLength(1);expect(files[0]).not.toHaveProperty('url');
    expect(await files[0].blob.text()).toBe('PRIVATE_PDF');expect(files[0].blob.type).toBe('application/pdf');
    expect(new TextDecoder().decode(bytes)).toBe('PRIVATE_PDF');
  });
  it('keeps an empty, oversized or rejected conversion from reaching the model', async () => {
    for(const [data,format,reason] of [['','markdown','AI_UNREADABLE_DOCUMENT'],['x'.repeat(45001),'markdown','AI_DOCUMENT_TOO_LONG'],['PRIVATE_PROVIDER_BODY','error','AI_UNREADABLE_DOCUMENT']]){
      await expect(convertAIFile({run:vi.fn(),toMarkdown:vi.fn().mockResolvedValue([{data,format}])},new Uint8Array([1]),'scan.pdf','application/pdf')).rejects.toMatchObject({reason});
    }
  });
  it('bounds a hung conversion and withholds raw provider failures', async () => {
    const hung=convertAIFile({run:vi.fn(),toMarkdown:()=>new Promise(()=>{})},new Uint8Array([1]),'scan.pdf','application/pdf',5);
    await expect(hung).rejects.toMatchObject({reason:'AI_TIMEOUT'});
    await expect(convertAIFile({run:vi.fn(),toMarkdown:vi.fn().mockRejectedValue(Error('PRIVATE_BODY'))},new Uint8Array([1]),'scan.pdf','application/pdf')).rejects.not.toThrow('PRIVATE_BODY');
  });
});
