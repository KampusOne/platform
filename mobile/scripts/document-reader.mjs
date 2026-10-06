import { getDocument } from 'unpdf/pdfjs';
if (!Promise.withResolvers) Promise.withResolvers = function () { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const hostOrigin = new URL(document.baseURI).origin;
const send = data => { const message = JSON.stringify(data); if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(message); else window.parent.postMessage(message, hostOrigin); };
let active = false;
window.readCampusDocument = async input => {
  if (active) return;
  active = true;
  let task;
  try {
    const url = new URL(input.url);
    if (url.protocol !== 'https:' || !['platformp.divine-haze-54eb.workers.dev', 'kampusone-mobile-preview.vercel.app'].includes(url.hostname) || !/^\/v1\/media\/[0-9a-f-]{36}$/.test(url.pathname) || !url.searchParams.has('access')) throw new Error('This file link is invalid. Reattach your document.');
    const pages = [];
    let totalPages = 1;
    if (input.type === 'text/plain') {
      const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok || !response.body) throw new Error('Your saved document could not load. Retry your attachment.');
      const reader = response.body.getReader(), decoder = new TextDecoder('utf-8');
      let text = '', bytes = 0;
      while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; if (bytes > 104857600) { await reader.cancel(); throw new Error('Compress this document to 100 MB or less.'); } text += decoder.decode(next.value, { stream: true }); if (text.length >= 1500000) { await reader.cancel(); break; } }
      text += decoder.decode();
      for (let i = 0; i < text.length; i += 7000) pages.push({ page: pages.length + 1, text: text.slice(i, i + 7000) });
      totalPages = pages.length;
    } else {
      task = getDocument({ url: url.href, useSystemFonts: false, disableFontFace: true, isEvalSupported: false, stopAtErrors: true, disableAutoFetch: true, rangeChunkSize: 262144 });
      const pdf = await task.promise;
      totalPages = pdf.numPages;
      const maxPages = Math.min(input.maxPages, 300);
      const indexes = totalPages <= maxPages ? Array.from({ length: totalPages }, (_, i) => i + 1) : [...new Set(Array.from({ length: maxPages }, (_, i) => 1 + Math.floor(i * (totalPages - 1) / (maxPages - 1))))];
      for (const n of indexes) {
        const page = await pdf.getPage(n), content = await page.getTextContent();
        const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim().slice(0, 30000);
        if (text) pages.push({ page: n, text });
        page.cleanup();
      }
    }
    if (!pages.length) throw new Error('This PDF contains scanned pages without readable text. Attach the pages you need as clear images, or an OCR text export.');
    const tokens = [...new Set((input.query.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(t => !['the', 'and', 'this', 'that', 'explain', 'summary', 'summarize', 'document', 'please', 'from'].includes(t)))].slice(0, 20);
    const ordered = tokens.length ? [...pages].sort((a, b) => tokens.reduce((s, t) => s + (b.text.toLowerCase().split(t).length - a.text.toLowerCase().split(t).length), 0) || a.page - b.page) : pages;
    const selected = []; let length = 0;
    for (const p of ordered) { if (length >= 43000) break; const text = p.text.slice(0, 43000 - length); selected.push({ ...p, text }); length += text.length + 30; }
    selected.sort((a, b) => a.page - b.page);
    const complete = pages.length === totalPages && selected.length === pages.length && pages.every(p => p.text.length < 30000) && length < 43000;
    const text = `[Document source: ${totalPages} ${input.type === 'text/plain' ? 'sections' : 'pages'}. ${complete ? 'Complete readable text.' : 'Selected source excerpts; omitted material is not available. Do not claim to have read the entire document.'}]\n` + selected.map(p => `[Page ${p.page}]\n${p.text}`).join('\n\n');
    send({ type: 'result', id: input.id, text });
  } catch (error) { send({ type: 'error', id: input.id, message: error.message || 'The document could not be read. Remove password protection or attach a clear page image.' }); }
  finally { await task?.destroy().catch(() => undefined); active = false; }
};
window.addEventListener('message', event => { if (event.source === window.parent && event.origin === hostOrigin && event.data && typeof event.data === 'object') void window.readCampusDocument(event.data); });
send({ type: 'ready' });
