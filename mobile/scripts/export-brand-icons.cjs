/* Deterministic exports of the supplied official K1 path. Never redraw the mark. */
const fs = require("node:fs");
const path = require("node:path");
const sharp = require(require.resolve("sharp", {
  paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || "", process.cwd()],
}));
const assets = path.resolve(__dirname, "../assets");
const source = fs.readFileSync(path.join(assets, "brand/K1_symbol_terracotta.svg"), "utf8");
const paths = source.match(/<path[^>]+\/>/g).join("");
function artwork({ background, ink, extent = 620 }) {
  // Tight original path bounds: x 38..156, y 14..141. Preserve their aspect ratio.
  const scale = extent / 127;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${background ? `<rect width="1024" height="1024" fill="${background}"/>` : ""}<g fill="${ink}" transform="translate(${512 - 97 * scale} ${512 - 77.5 * scale}) scale(${scale})">${paths}</g></svg>`;
}
async function save(file, options, size = 1024) {
  await sharp(Buffer.from(artwork(options))).resize(size, size).png().toFile(path.join(assets, file));
}
(async () => {
  await save("icon.png", { background: "#A8462E", ink: "#FFFFFF", extent: 620 });
  // Android masks the background; the foreground never bakes in a rounded square.
  await save("adaptive-icon.png", { ink: "#FFFFFF", extent: 600 });
  await save("monochrome-icon.png", { ink: "#FFFFFF", extent: 600 });
  await save("splash-icon.png", { ink: "#C35D38", extent: 650 });
  await save("favicon.png", { background: "#A8462E", ink: "#FFFFFF", extent: 720 }, 64);
  await save("brand/kampusone-symbol-solid.png", { ink: "#C35D38", extent: 880 }, 512);
  const publicDir=path.resolve(__dirname,"../public");fs.mkdirSync(publicDir,{recursive:true});
  const layers=[];
  for(const size of [16,32,48,180,192,512]) {
    const png=await sharp(Buffer.from(artwork({background:"#A8462E",ink:"#FFFFFF",extent:size>=192?600:720}))).resize(size,size).png().toBuffer();
    fs.writeFileSync(path.join(publicDir,`icon-${size}.png`),png);
    if(size<=48)layers.push({size,png});
  }
  const header=Buffer.alloc(6+16*layers.length);header.writeUInt16LE(1,2);header.writeUInt16LE(layers.length,4);let offset=header.length;
  layers.forEach(({size,png},i)=>{const n=6+i*16;header[n]=header[n+1]=size;header.writeUInt16LE(1,n+4);header.writeUInt16LE(32,n+6);header.writeUInt32LE(png.length,n+8);header.writeUInt32LE(offset,n+12);offset+=png.length;});
  fs.writeFileSync(path.join(publicDir,'favicon.ico'),Buffer.concat([header,...layers.map(l=>l.png)]));
  fs.writeFileSync(path.join(publicDir,'manifest.webmanifest'),JSON.stringify({id:'/',name:'KampusOne',short_name:'KampusOne',start_url:'/',scope:'/',display:'standalone',background_color:'#FBF7F2',theme_color:'#A8462E',icons:[192,512].map(size=>({src:`/icon-${size}.png`,sizes:`${size}x${size}`,type:'image/png',purpose:'any maskable'}))},null,2));
})();
