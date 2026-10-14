import { decode as decodeJpeg } from 'jpeg-js';
import { decode as decodePng, encode as encodePng } from 'fast-png';
import type { AIMedia } from './ai-provider';

type Pixels = { width:number; height:number; data:Uint8Array };
export type TimetableImageRow = { day:number; cells:{from:number;to:number}[]; media:AIMedia };
const maxPixels=4_000_000;
function pixels(media:AIMedia):Pixels|undefined {
  const bytes=Uint8Array.from(atob(media.data),c=>c.charCodeAt(0));
  if(media.mimeType==='image/jpeg')return decodeJpeg(bytes,{useTArray:true,maxResolutionInMP:4,maxMemoryUsageInMB:48,tolerantDecoding:false});
  if(media.mimeType!=='image/png'||bytes.length<24)return;
  const view=new DataView(bytes.buffer);
  if(view.getUint32(16)*view.getUint32(20)>maxPixels)return;
  const png=decodePng(bytes);
  if(png.depth!==8||png.channels<3||png.width*png.height>maxPixels)return;
  const data=new Uint8Array(png.width*png.height*4);
  for(let i=0;i<png.width*png.height;i++) {
    const alpha=png.channels===4?png.data[i*4+3]!/255:1;
    for(let c=0;c<3;c++)data[i*4+c]=Math.round(png.data[i*png.channels+c]!*alpha+255*(1-alpha));
    data[i*4+3]=255;
  }
  return {width:png.width,height:png.height,data};
}
function groups(values:number[]) {
  const result:number[][]=[];
  for(const n of values) {const last=result.at(-1);if(last&&n===last.at(-1)!+1)last.push(n);else result.push([n]);}
  return result;
}
const digitRows=['111101101101111','010110010010111','111001111100111','111001111001111','101101111001001','111100111001111','111100111101111','111001001001001','111101111101111','111101111001111'];

/** The first vision read needs only headings and the day/level inventory. A
 * compact contact sheet removes course distractions and large JPEG payloads.
 * All source labels are retained, in numbered panel order, without text OCR. */
export function timetableLayoutImage(media:AIMedia):AIMedia|undefined {
  try {
    const im=pixels(media);if(!im||im.width*im.height>maxPixels)return;
    const radius=Math.max(1,Math.round(im.width/700));
    const gray=(x:number,y:number)=>{const p=(y*im.width+x)*4;return (im.data[p]!+im.data[p+1]!+im.data[p+2]!)/3;};
    let horizontal:number[]=[];
    const left=Math.ceil(im.width*.10),right=Math.floor(im.width*.98);
    for(const threshold of [180,200,220]) {
      const candidates:number[]=[];
      for(let y=radius;y<im.height-radius;y++) {
        let count=0;for(let x=left;x<right;x++){for(let dy=-radius;dy<=radius;dy++)if(gray(x,y+dy)<threshold){count++;break;}}
        if(count>(right-left)*.8)candidates.push(y);
      }
      const lines=groups(candidates).filter(g=>g.length<=radius*5).map(g=>Math.round(g.reduce((a,b)=>a+b,0)/g.length));
      while(lines.length>3&&lines[1]!-lines[0]!>(lines[2]!-lines[1]!)*2)lines.shift();
      const gaps=lines.slice(1).map((y,i)=>y-lines[i]!);const median=gaps.slice().sort((a,b)=>a-b)[Math.floor(gaps.length/2)];
      if(lines.length>=12&&median&&gaps.every(g=>g>=radius*3&&g<=median*3)&&gaps[0]!<=median*1.8&&lines.length>horizontal.length)horizontal=lines;
    }
    if(!horizontal.length)return;
    const top=horizontal[0]!,bottom=horizontal.at(-1)!,candidates:number[]=[];
    for(let x=radius;x<im.width-radius;x++) {
      let count=0;for(let y=top;y<bottom;y++)for(let dx=-radius;dx<=radius;dx++)if(gray(x+dx,y)<180){count++;break;}
      if(count>(bottom-top)*.7)candidates.push(x);
    }
    const vertical=groups(candidates).filter(g=>g.length<=radius*7).map(g=>Math.round(g.reduce((a,b)=>a+b,0)/g.length));
    if(vertical.length<8||vertical.length>27)return;
    const headerIndex=horizontal.findIndex((y,i)=>{
      const end=horizontal[i+1];if(end===undefined)return false;
      let walls=0;
      for(const x of vertical) {
        let count=0,total=0;for(let yy=y+radius*2;yy<end-radius;yy++){total++;for(let dx=-radius;dx<=radius;dx++)if(gray(x+dx,yy)<200){count++;break;}}
        if(total&&count/total>=.90)walls++;
      }
      return walls>=vertical.length*.85;
    });
    if(headerIndex<0)return;
    horizontal=horizontal.slice(headerIndex);
    const headerTop=horizontal[0]!;
    const middle=2+Math.floor((vertical.length-3)/2),scale=2;
    const strips=[{x0:vertical[2]!,x1:vertical[middle]!,y0:headerTop,y1:horizontal[1]!},
      {x0:vertical[middle]!,x1:vertical.at(-1)!,y0:headerTop,y1:horizontal[1]!}];
    let row=1;
    while(row<horizontal.length-1) {
      let end=row+1;while(end+1<horizontal.length&&horizontal[end+1]!-horizontal[row]!<=100)end++;
      strips.push({x0:vertical[0]!,x1:vertical[2]!,y0:horizontal[row]!,y1:horizontal[end]!});row=end;
    }
    const width=Math.max(...strips.slice(0,2).map(s=>(s.x1-s.x0)*scale+32),(vertical[2]!-vertical[0]!)*scale*3+96);
    const headerHeight=(horizontal[1]!-headerTop)*scale+30,tileWidth=(vertical[2]!-vertical[0]!)*scale+32,tileHeight=230;
    const height=headerHeight*2+Math.ceil((strips.length-2)/3)*tileHeight;
    if(width*height>maxPixels)return;
    const out=new Uint8Array(width*height*4).fill(255);
    for(let i=0;i<strips.length;i++) {
      const s=strips[i]!,baseX=i<2?0:((i-2)%3)*tileWidth,baseY=i<2?i*headerHeight:headerHeight*2+Math.floor((i-2)/3)*tileHeight;
      for(const [j,digit] of String(i).split('').entries())for(let r=0;r<5;r++)for(let c=0;c<3;c++)if(digitRows[Number(digit)]![r*3+c]==='1')for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++) {
        const p=((baseY+4+r*2+dy)*width+baseX+4+j*8+c*2+dx)*4;out[p]=out[p+1]=out[p+2]=0;
      }
      for(let y=s.y0;y<=s.y1;y++)for(let x=s.x0;x<=s.x1;x++)for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++) {
        const p=((baseY+20+(y-s.y0)*scale+dy)*width+baseX+16+(x-s.x0)*scale+dx)*4;
        const shade=gray(x,y);out[p]=out[p+1]=out[p+2]=shade>235?255:Math.round(shade/16)*16;
      }
    }
    const encoded=encodePng({width,height,data:out,channels:4,depth:8});let binary='';for(let i=0;i<encoded.length;i+=8192)binary+=String.fromCharCode(...encoded.subarray(i,i+8192));
    return {mimeType:'image/png',data:btoa(binary)};
  }catch{return;}
}

/** Detect ruled table borders from private pixels, then isolate the selected
 * level's cells. Models transcribe cell labels; they never choose the level,
 * column index or duration. Nothing leaves the existing private AI adapter.
 * Unsupported/ambiguous geometry is a failed read, never guessed geometry. */
export function timetableImageRows(media:AIMedia,timeColumnCount:number,levels:string[],days:number[],selectedLevel:string):TimetableImageRow[]|undefined {
  try {
    const im=pixels(media);
    if(!im||im.width*im.height>maxPixels||levels.length<2||timeColumnCount<1||timeColumnCount>24||!days.length)return;
    const selected=levels.indexOf(selectedLevel);
    if(selected<0||new Set(levels).size!==levels.length)return;
    const radius=Math.max(1,Math.round(im.width/700));
    const gray=(x:number,y:number)=>{const i=(y*im.width+x)*4;return (im.data[i]!+im.data[i+1]!+im.data[i+2]!)/3;};
    const darkY=(x:number,y:number,t:number)=>{for(let dy=-radius;dy<=radius;dy++)if(gray(x,y+dy)<t)return true;return false;};
    const darkX=(x:number,y:number,t:number)=>{for(let dx=-radius;dx<=radius;dx++)if(gray(x+dx,y)<t)return true;return false;};
    const left=Math.ceil(im.width*.10),right=Math.floor(im.width*.98),wanted=days.length*levels.length+2;
    let horizontal:number[]|undefined;
    for(const threshold of [160,180,200,220]) {
      const candidates:number[]=[];
      for(let y=radius;y<im.height-radius;y++) {
        let n=0;for(let x=left;x<right;x++)if(darkY(x,y,threshold))n++;
        if(n>(right-left)*.80)candidates.push(y);
      }
      const lines=groups(candidates).filter(g=>g.length<=radius*5).map(g=>Math.round(g.reduce((a,b)=>a+b,0)/g.length));
      // A screenshot can have a straight edge above the table. Discard only
      // isolated edges; never discard an unexplained timetable row.
      while(lines.length>wanted&&lines[1]!-lines[0]!>(lines[2]!-lines[1]!)*2)lines.shift();
      if(lines.length!==wanted)continue;
      const gaps=lines.slice(1).map((y,i)=>y-lines[i]!);
      const median=gaps.slice().sort((a,b)=>a-b)[Math.floor(gaps.length/2)]!;
      if(gaps.some(g=>g<radius*3||g>median*3)||gaps[0]!>median*1.8)continue;
      horizontal=lines;break;
    }
    if(!horizontal)return;
    const top=horizontal[0]!,bottom=horizontal.at(-1)!;
    let vertical:number[]|undefined;
    for(const threshold of [180,200,220])for(const fraction of [.70,.60,.50]) {
      if(vertical)break;
      const candidates:number[]=[];
      for(let x=radius;x<im.width-radius;x++) {
        let n=0;for(let y=top;y<bottom;y++)if(darkX(x,y,threshold))n++;
        if(n>(bottom-top)*fraction)candidates.push(x);
      }
      const lines=groups(candidates).filter(g=>g.length<=radius*7).map(g=>Math.round(g.reduce((a,b)=>a+b,0)/g.length));
      if(lines.length===timeColumnCount+3)vertical=lines;
    }
    if(!vertical)return;
    const columns=vertical.slice(2);
    const results:TimetableImageRow[]=[];
    for(let d=0;d<days.length;d++) {
      const index=1+d*levels.length+selected,y0=horizontal[index]!,y1=horizontal[index+1]!;
      const borders=[0];
      for(let c=1;c<timeColumnCount;c++) {
        let count=0,total=0;
        for(let y=y0+radius*2;y<y1-radius;y++) {total++;if(darkX(columns[c]!,y,190))count++;}
        if(!total)return;
        if(count/total>=.90)borders.push(c);
        else if(count/total>.85)return; // damaged border: do not invent a merge
      }
      borders.push(timeColumnCount);
      const cells=borders.slice(1).map((to,i)=>({from:borders[i]!,to}));
      const scale=Math.max(1,Math.min(4,Math.floor(1600/(columns.at(-1)!-columns[0]!))));
      const width=(columns.at(-1)!-columns[0]!)*scale+60,panelHeight=(y1-y0)*scale+32,height=panelHeight*(cells.length+1);
      if(width*height>maxPixels)return;
      const out=new Uint8Array(width*height*4).fill(255);
      const dot=(x:number,y:number)=>{if(x>=width||y>=height)return;const p=(y*width+x)*4;out[p]=out[p+1]=out[p+2]=0;};
      for(let i=0;i<=cells.length;i++) {
        const cell=cells[i-1],start=i===0?vertical[1]!:columns[cell!.from]!,end=i===0?vertical[2]!:columns[cell!.to]!,base=i*panelHeight;
        // Fixed panel numbers make blank cells explicit and keep their order.
        for(const [j,digit] of String(i).split('').entries())for(let r=0;r<5;r++)for(let c=0;c<3;c++)if(digitRows[Number(digit)]![r*3+c]==='1')
          for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++)dot(8+j*12+c*3+dx,base+8+r*3+dy);
        for(let y=y0+1;y<y1;y++)for(let x=start+1;x<end;x++)for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++) {
          const p=((base+24+(y-y0)*scale+dy)*width+40+(x-start)*scale+dx)*4,q=(y*im.width+x)*4;
          out[p]=im.data[q]!;out[p+1]=im.data[q+1]!;out[p+2]=im.data[q+2]!;
        }
        for(let x=0;x<width;x++)dot(x,base+panelHeight-1);
      }
      const encoded=encodePng({width,height,data:out,channels:4,depth:8});
      let binary='';for(let i=0;i<encoded.length;i+=8192)binary+=String.fromCharCode(...encoded.subarray(i,i+8192));
      results.push({day:days[d]!,cells,media:{mimeType:'image/png',data:btoa(binary)}});
    }
    return results;
  }catch{return;}
}
