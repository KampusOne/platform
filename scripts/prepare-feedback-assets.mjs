import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const sharp=createRequire(new URL('../portal/package.json',import.meta.url))('sharp');
const root=new URL('../',import.meta.url);
// The supplied logo paths are retained verbatim, centered inside a square tile.
const symbol=await readFile(new URL('mobile/assets/brand/K1_symbol_terracotta.svg',root),'utf8');
const group=symbol.match(/<g[\s\S]*<\/g>/)?.[0];
if(!group)throw new Error('Official logo group missing');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" rx="38" fill="#FBF7F2"/><g transform="translate(0 20)">${group}</g></svg>`;
await writeFile(new URL('portal/app/icon.svg',root),svg+'\n');
const png=await sharp(Buffer.from(svg)).resize(64,64).png().toBuffer();
await writeFile(new URL('mobile/assets/favicon.png',root),png);
// PNG-compressed ICO is supported by current Android/desktop browsers.
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=64;header[7]=64;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
for(const path of ['portal/app/favicon.ico','mobile/public/favicon.ico'])await writeFile(new URL(path,root),Buffer.concat([header,png]));
