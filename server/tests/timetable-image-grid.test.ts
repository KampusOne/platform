import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {decode as decodeJpeg} from 'jpeg-js';
import {encode as encodePng,decode as decodePng} from 'fast-png';
import {timetableImageRows,timetableLayoutImage} from '../src/lib/timetable-image-grid';
const bytes=readFileSync(new URL('../../scripts/fixtures/uniben-engineering-2026.jpg',import.meta.url));
const levels=['100','200','300','400','500'],days=[1,2,3,4,5];
const expected=[[[0,2],[2,6],[6,7],[7,8],[8,9],[9,10]],[[0,1],[1,3],[3,4],[4,6],[6,7],[7,8],[8,9],[9,10]],[[0,1],[1,2],[2,6],[6,7],[7,9],[9,10]],[[0,1],[1,2],[2,3],[3,6],[6,8],[8,9],[9,10]],[[0,1],[1,2],[2,3],[3,4],[4,5],[5,7],[7,8],[8,9],[9,10]]];
describe('printed grid pixel geometry',()=>{
  it('keeps the full heading inventory in a bounded compact image',()=>{
    const result=timetableLayoutImage({mimeType:'image/jpeg',data:bytes.toString('base64')});
    expect(result?.mimeType).toBe('image/png');expect(result!.data.length).toBeLessThan(bytes.length);
    const decoded=decodePng(Buffer.from(result!.data,'base64'));expect(decoded.width*decoded.height).toBeLessThan(500000);
  });
  it.each(['jpeg','png'])('preserves actual level rows, blanks and merged spans in %s',mime=>{
    const encoded=mime==='jpeg'?bytes:encodePng({...decodeJpeg(bytes,{useTArray:true}),channels:4,depth:8});
    const result=timetableImageRows({mimeType:'image/'+mime,data:Buffer.from(encoded).toString('base64')},10,levels,days,'200');
    expect(result?.map(row=>row.cells.map(cell=>[cell.from,cell.to]))).toEqual(expected);
    expect(result?.map(row=>row.day)).toEqual(days);
    expect(result?.every(row=>{const image=decodePng(Buffer.from(row.media.data,'base64'));return image.width>100&&image.width*image.height<=4_000_000;})).toBe(true);
  });
  it('rejects missing printed rows, an absent level and an invalid source',()=>{
    const image={mimeType:'image/jpeg',data:bytes.toString('base64')};
    expect(timetableImageRows(image,10,levels,[1,2,3,4],'200')).toBeUndefined();
    expect(timetableImageRows(image,10,levels,days,'600')).toBeUndefined();
    expect(timetableImageRows({...image,data:btoa('unreadable')},10,levels,days,'200')).toBeUndefined();
  });
});
