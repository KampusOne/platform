import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = resolve(import.meta.dirname, '..'), evidence = process.env.UI_EVIDENCE_DIR || '/tmp/kampusone-reader-evidence';
mkdirSync(evidence, { recursive: true });
function pdfFixture() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>'];
  for (let n=0; n<3; n++) {
    const drawing = '.66 .27 .18 rg 20 20 260 380 re f 1 1 1 rg 40 60 220 280 re f';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 420] /Contents ${4+n*2} 0 R >>`, `<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`);
  }
  let data = '%PDF-1.4\n', offsets = [];
  for (const [n, object] of objects.entries()) { offsets.push(Buffer.byteLength(data)); data += `${n+1} 0 obj\n${object}\nendobj\n`; }
  data += '%' + ' '.repeat(1_000_000) + '\n';
  const xref = Buffer.byteLength(data);
  data += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n` + offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(data);
}
const pdf = pdfFixture(), requests = [];
const server = createServer((req,res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/book.pdf' || path === '/stalled.pdf') {
    requests.push({ path, range: req.headers.range });
    const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Cache-Control', 'no-store');
    if (path === '/stalled.pdf') { res.setHeader('Content-Length', pdf.length); res.writeHead(200); res.flushHeaders(); return; }
    const start=range ? Number(range[1]) : 0, end=range ? Math.min(pdf.length-1,Number(range[2])) : pdf.length-1;
    res.setHeader('Content-Length', end-start+1);
    if(range) {res.setHeader('Content-Range', `bytes ${start}-${end}/${pdf.length}`);res.writeHead(206);res.end(pdf.subarray(start,end+1));}
    else {res.writeHead(200);res.write(pdf.subarray(0,262144)); /* intentionally leave the full download pending */}
    return;
  }
  const file = path === '/' ? 'viewer.html' : path.replace('/documents/', '');
  if (!['viewer.html','viewer.js','inter.ttf'].includes(file)) {res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type', file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'font/ttf');
  res.end(readFileSync(resolve(root, 'mobile/public/documents', file)));
});
await new Promise(done => server.listen(8111,'127.0.0.1',done));
let browser;
try {
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:3}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:8111/');await page.waitForFunction(()=>typeof window.openLearningDocument==='function');
  const started=Date.now();
  await page.evaluate(()=>void window.openLearningDocument({url:'http://localhost:8111/book.pdf?access=synthetic',title:'Synthetic book'}));
  await page.getByRole('img',{name:'PDF page 1',exact:true}).waitFor({timeout:10000});
  assert.ok(Date.now()-started<10000,'First page waits for the whole download');
  assert.ok(requests.some(r=>r.range),'A PDF larger than the initial chunk must use byte ranges');
  const pixels=await page.locator('canvas').first().evaluate(n=>({pixels:n.width,css:n.getBoundingClientRect().width}));assert.ok(pixels.pixels>=pixels.css*2);
  const viewport=page.locator('#viewport'),rect=await viewport.boundingBox(),cdp=await context.newCDPSession(page),cx=rect.x+190,cy=rect.y+220;
  const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
  await touch('touchStart',[{x:cx-35,y:cy},{x:cx+35,y:cy}]);
  for(let n=1;n<=5;n++)await touch('touchMove',[{x:cx-35-n*7,y:cy},{x:cx+35+n*7,y:cy}]);
  await touch('touchEnd',[]);await page.locator('#fit').filter({hasText:'200%'}).waitFor();
  // Moving the midpoint pans the content rather than accelerating its scale.
  const before=await viewport.evaluate(n=>n.scrollLeft);
  await touch('touchStart',[{x:cx-35,y:cy},{x:cx+35,y:cy}]);
  await touch('touchMove',[{x:cx-65,y:cy},{x:cx+5,y:cy}]);await touch('touchEnd',[]);
  assert.equal(await page.locator('#fit').innerText(),'200%');assert.ok((await viewport.evaluate(n=>n.scrollLeft))>before+20);
  await page.getByRole('button',{name:'Fit PDF to screen width',exact:true}).click();
  await touch('touchStart',[{x:cx,y:cy+200}]);for(let n=1;n<=5;n++)await touch('touchMove',[{x:cx,y:cy+200-n*70}]);await touch('touchEnd',[]);
  await page.waitForFunction(()=>document.querySelector('#viewport').scrollTop>120);
  await page.screenshot({path:resolve(evidence,'pdf-pinch-scroll.png')});
  await page.clock.install();const stalledRequest=page.waitForRequest(r=>r.url().includes('stalled.pdf'));await page.evaluate(()=>void window.openLearningDocument({url:'http://localhost:8111/stalled.pdf?access=synthetic',title:'Stalled source'}));
  await stalledRequest;
  await page.clock.fastForward(16000);await page.getByRole('alert').filter({hasText:'stopped downloading'}).waitFor();
  assert.deepEqual(errors,[]);
  const result={partialDownloadRenders:true,deviceDensity:true,pinchFollowsFingers:true,twoFingerPan:true,verticalSwipe:true,stalledSourceShowsRetry:true};
  writeFileSync(resolve(evidence,'reader-checks.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await context.close();
} finally {await browser?.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
