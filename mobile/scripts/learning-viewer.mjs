import { getDocument } from 'unpdf/pdfjs';
if (!Promise.withResolvers) Promise.withResolvers = function () { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const viewport = document.querySelector('#viewport'), pages = document.querySelector('#pages');
const status = document.querySelector('#status'), error = document.querySelector('#error'), errorMessage = document.querySelector('#error-message');
const label = document.querySelector('#page-label'), counter = document.querySelector('#page-counter');
const previous = document.querySelector('#previous'), next = document.querySelector('#next'), zoomIn = document.querySelector('#zoom-in'), zoomOut = document.querySelector('#zoom-out'), fit = document.querySelector('#fit');
const dialog = document.querySelector('#jump-dialog'), input = document.querySelector('#page-input');
let pdf = null, task = null, inputDocument = null, generation = 0, zoom = 1, currentPage = 1, records = [], renderQueue = [], activeRenders = 0, resizeTimer, zoomTimer, scrollFrame;
const minimumZoom = 0.5, maximumZoom = 4;
const width = () => Math.max(1, viewport.clientWidth - 12);
function updateControls() {
  label.textContent = pdf ? `${currentPage} / ${pdf.numPages}` : 'Loading…';
  counter.textContent = label.textContent; counter.hidden = !pdf;
  previous.disabled = !pdf || currentPage <= 1; next.disabled = !pdf || currentPage >= pdf.numPages;
  zoomIn.disabled = !pdf || zoom >= maximumZoom; zoomOut.disabled = !pdf || zoom <= minimumZoom;
  label.disabled = fit.disabled = !pdf; fit.textContent = `${Math.round(zoom * 100)}%`;
}
function layout() {
  const pageWidth = width() * zoom;
  pages.style.width = `${Math.max(viewport.clientWidth, pageWidth + 12)}px`;
  for (const record of records) { record.node.style.width = `${pageWidth}px`; record.node.style.height = `${pageWidth * record.ratio}px`; }
}
function nearby(record) {
  const top=record.node.offsetTop-pages.offsetTop, height=viewport.clientHeight;
  return top+record.node.offsetHeight>=viewport.scrollTop-height && top<=viewport.scrollTop+height*2;
}
function enqueue(record, retry = false) {
  if (!record || record.queued || record.rendering || record.failed && !retry || record.renderedZoom === zoom && Math.abs((record.renderedWidth || 0)-width()*zoom)<0.5) return;
  record.failed = false; record.queued = true; renderQueue.push(record); void pump();
}
async function pump() {
  if (activeRenders >= 2 || !renderQueue.length || !pdf) return;
  const record = renderQueue.shift(); record.queued = false;
  if (record.generation !== generation || !nearby(record)) { void pump(); return; }
  activeRenders++; record.rendering = true;
  const turn = generation, atZoom = zoom, documentPdf = pdf;
  let page, canvas;
  try {
    record.message.textContent = `Loading page ${record.number}…`;
    page = await documentPdf.getPage(record.number);
    if (turn !== generation) return;
    const base = page.getViewport({ scale: 1 });
    const ratio = base.height / base.width;
    if (Math.abs(record.ratio - ratio) > 0.001) { record.ratio = ratio; record.node.style.height = `${width() * zoom * ratio}px`; }
    const cssWidth = width() * atZoom;
    // Honour device density and rerender after zoom. Bound each canvas to 6 MP
    // and 4096 px so a scanned 94-page book cannot exhaust a mid-range phone.
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    const pixelWidth = Math.min(cssWidth * pixelRatio, 4096, Math.sqrt(6_000_000 / ratio));
    const view = page.getViewport({ scale: pixelWidth / base.width });
    canvas = document.createElement('canvas'); canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height);
    canvas.setAttribute('aria-label', `PDF page ${record.number}`); canvas.setAttribute('role', 'img');
    record.renderTask = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), canvas, viewport: view });
    await record.renderTask.promise;
    if (turn !== generation || !record.node.isConnected) return;
    if (record.canvas) { record.canvas.remove(); record.canvas.width = record.canvas.height = 0; }
    record.canvas = canvas; canvas = null; record.node.append(record.canvas); record.message.hidden = true;
    record.renderedZoom = atZoom; record.renderedWidth = cssWidth; record.node.classList.remove('retry'); record.node.removeAttribute('tabindex');
  } catch (caught) {
    if (turn === generation && caught?.name !== 'RenderingCancelledException') {
      record.failed = true; record.message.hidden = false; record.message.textContent = `Page ${record.number} could not load. Tap to retry.`;
      record.node.classList.add('retry'); record.node.tabIndex = 0;
    }
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    page?.cleanup(); record.renderTask = null; record.rendering = false; activeRenders--;
    if (turn === generation && !record.failed && nearby(record) && (record.renderedZoom !== zoom || Math.abs((record.renderedWidth || 0)-width()*zoom)>0.5)) enqueue(record);
    void pump();
  }
}
function refreshVisible() {
  if (!pdf) return;
  const top = viewport.scrollTop, bottom = top + viewport.clientHeight, preload = viewport.clientHeight;
  let nearest = records[0], distance = Infinity;
  for (const record of records) {
    const pageTop = record.node.offsetTop - pages.offsetTop, pageBottom = pageTop + record.node.offsetHeight;
    const nextDistance = Math.abs((pageTop + pageBottom) / 2 - (top + viewport.clientHeight * 0.45));
    if (nextDistance < distance) { nearest = record; distance = nextDistance; }
    if (pageBottom >= top - preload && pageTop <= bottom + preload) enqueue(record);
    else if (record.canvas && !record.rendering) { record.canvas.remove(); record.canvas.width = record.canvas.height = 0; record.canvas = null; record.renderedZoom = 0; record.message.hidden = false; record.message.textContent = `Page ${record.number}`; }
  }
  renderQueue = renderQueue.filter(record => { if(nearby(record))return true; record.queued=false; return false; });
  if (nearest) currentPage = nearest.number;
  updateControls();
}
function goToPage(number) {
  if (!pdf) return;
  const target = records[Math.min(pdf.numPages, Math.max(1, number)) - 1];
  viewport.scrollTop = target.node.offsetTop - pages.offsetTop; currentPage = target.number; updateControls(); refreshVisible();
}
function changeZoom(value, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2, render = true) {
  if (!pdf) return;
  const nextZoom = Math.min(maximumZoom, Math.max(minimumZoom, value));
  const scale = nextZoom / zoom, anchorX = viewport.scrollLeft + x, anchorY = viewport.scrollTop + y;
  zoom = nextZoom; layout(); viewport.scrollLeft = anchorX * scale - x; viewport.scrollTop = anchorY * scale - y; updateControls();
  clearTimeout(zoomTimer); zoomTimer = setTimeout(refreshVisible, render ? 0 : 160);
}
async function openDocument(data) {
  inputDocument = data;
  const turn = ++generation;
  const oldTask = task; task = null; pdf = null; renderQueue = [];
  for (const record of records) { record.renderTask?.cancel(); if(record.canvas) record.canvas.width = record.canvas.height = 0; }
  records = []; pages.replaceChildren(); viewport.scrollTop = viewport.scrollLeft = 0;
  zoom = 1; currentPage = 1; error.classList.remove('visible'); status.hidden = false; updateControls();
  document.body.dataset.theme = data.dark ? 'dark' : 'light';
  try {
    await oldTask?.destroy();
    if (turn !== generation) return;
    const target = new URL(data.url, location.origin);
    const localHost = hostname => ['localhost','127.0.0.1','[::1]'].includes(hostname);
    const localDevelopment = location.protocol === 'http:' && localHost(location.hostname) && target.protocol === 'http:' && localHost(target.hostname);
    if (target.protocol !== 'https:' && !localDevelopment || !target.searchParams.has('access')) throw Error('This private link has expired. Reopen the material.');
    document.title = data.title || 'Learning document';
    task = getDocument({ url: target.href, disableAutoFetch: true, disableStream: true, isEvalSupported: false, rangeChunkSize: 262144 });
    const result = await task.promise;
    if (turn !== generation) return;
    pdf = result;
    const first = await pdf.getPage(1), base = first.getViewport({ scale: 1 });
    const ratio = base.height / base.width; first.cleanup();
    const fragment = document.createDocumentFragment();
    for (let number = 1; number <= pdf.numPages; number++) {
      const node = document.createElement('section'), message = document.createElement('span');
      node.className = 'page'; node.setAttribute('aria-label', `Page ${number}`); message.className = 'page-status'; message.textContent = `Page ${number}`; node.append(message);
      const record = { number, node, message, ratio, generation: turn, renderedZoom: 0, queued: false, rendering: false, failed: false, canvas: null };
      const retry = () => { if (record.failed) enqueue(record, true); }; node.addEventListener('click', retry); node.addEventListener('keydown', event => { if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); retry(); } });
      records.push(record); fragment.append(node);
    }
    pages.append(fragment); input.max = String(pdf.numPages); layout(); status.hidden = true; updateControls(); refreshVisible();
  } catch (caught) {
    if (turn !== generation) return;
    status.hidden = true; errorMessage.textContent = caught?.message || 'This document could not load. Try again when you are online.'; error.classList.add('visible');
  }
}
window.openLearningDocument = openDocument;
previous.onclick = () => goToPage(currentPage - 1); next.onclick = () => goToPage(currentPage + 1);
zoomIn.onclick = () => changeZoom(zoom + 0.25); zoomOut.onclick = () => changeZoom(zoom - 0.25); fit.onclick = () => changeZoom(1);
document.querySelector('#retry').onclick = () => { if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage('refresh-access');else if(window.parent!==window)window.parent.postMessage('refresh-access',location.origin);else if(inputDocument)void openDocument(inputDocument); };
label.onclick = () => { if(!pdf)return; input.value = String(currentPage); document.querySelector('#jump-error').textContent = ''; dialog.showModal(); input.focus(); input.select(); };
document.querySelector('#cancel-jump').onclick = () => dialog.close();
function jumpToInputPage() { const number = Number(input.value); if(!pdf || !Number.isInteger(number) || number < 1 || number > pdf.numPages) { document.querySelector('#jump-error').textContent = `Choose a page from 1 to ${pdf?.numPages || 1}.`; return; } dialog.close(); goToPage(number); }
// Page navigation is a local action. Sandboxed embeds deliberately disallow
// form submission, so Go and Enter must not depend on a submit event.
document.querySelector('#go').onclick = jumpToInputPage;
input.addEventListener('keydown', event => { if(event.key === 'Enter') { event.preventDefault(); jumpToInputPage(); } });
document.querySelector('#jump-form').onsubmit = event => { event.preventDefault(); jumpToInputPage(); };
viewport.addEventListener('scroll', () => { if(!scrollFrame) scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; refreshVisible(); }); }, { passive: true });
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { const number = currentPage; for(const record of records)record.renderedZoom = 0; layout(); goToPage(number); }, 120); });
viewport.addEventListener('dblclick', event => { const rect = viewport.getBoundingClientRect(); changeZoom(zoom > 1.4 ? 1 : 2, event.clientX - rect.left, event.clientY - rect.top); });
let pinch = null, lastTap = null, startTouch = null;
const span = touches => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
viewport.addEventListener('touchstart', event => {
  if(event.touches.length === 2) { const rect = viewport.getBoundingClientRect(); pinch = { distance: span(event.touches), zoom, x: (event.touches[0].clientX + event.touches[1].clientX)/2-rect.left, y: (event.touches[0].clientY + event.touches[1].clientY)/2-rect.top }; startTouch = null; lastTap = null; }
  else if(event.touches.length === 1) startTouch = { x: event.touches[0].clientX, y: event.touches[0].clientY, time: Date.now() };
}, { passive: true });
viewport.addEventListener('touchmove', event => { if(event.touches.length === 2 && pinch) { event.preventDefault(); changeZoom(pinch.zoom * span(event.touches)/Math.max(1,pinch.distance),pinch.x,pinch.y,false); } }, { passive: false });
viewport.addEventListener('touchend', event => {
  if(pinch) { if(event.touches.length < 2) { pinch = null; refreshVisible(); } startTouch = null; return; }
  if(startTouch && event.changedTouches.length === 1) {
    const touch = event.changedTouches[0], now = Date.now();
    if(now-startTouch.time < 250 && Math.hypot(touch.clientX-startTouch.x,touch.clientY-startTouch.y)<12) {
      if(lastTap && now-lastTap.time < 300 && Math.hypot(touch.clientX-lastTap.x,touch.clientY-lastTap.y)<30) { event.preventDefault(); const rect=viewport.getBoundingClientRect(); changeZoom(zoom > 1.4 ? 1 : 2,touch.clientX-rect.left,touch.clientY-rect.top); lastTap=null; }
      else lastTap = { x:touch.clientX,y:touch.clientY,time:now };
    } else lastTap = null;
  }
  startTouch = null;
}, { passive: false });
viewport.addEventListener('touchcancel', () => { pinch = startTouch = lastTap = null; refreshVisible(); }, { passive: true });
viewport.addEventListener('wheel', event => { if(event.ctrlKey) { event.preventDefault(); const rect=viewport.getBoundingClientRect(); changeZoom(zoom * (event.deltaY < 0 ? 1.1 : 0.9),event.clientX-rect.left,event.clientY-rect.top); } }, { passive: false });
window.addEventListener('message', event => { if(event.origin === location.origin && event.source === window.parent && event.data?.url) void openDocument(event.data); });
window.addEventListener('pagehide', () => { generation++; renderQueue=[]; for(const record of records)record.renderTask?.cancel(); void task?.destroy(); });
if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage('ready');else window.parent.postMessage('ready',location.origin);
