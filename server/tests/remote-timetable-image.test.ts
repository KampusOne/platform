import {readFileSync} from 'node:fs';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {importJWK} from 'jose';
import {privateTimetableImage} from '../../portal/lib/private-timetable-image';
import {imageProcessingPublicKey,imageProcessingToken} from '../src/lib/image-processing-auth';
import {imageProcessorURL,remoteTimetableLayout,remoteTimetableRows} from '../src/lib/remote-timetable-image';

const secret='private-image-test-secret-'.repeat(3),env={JWT_SECRET:secret,TIMETABLE_IMAGE_PROCESSOR_URL:imageProcessorURL};
const levels=['100','200','300','400','500'],days=[1,2,3,4,5];
const media=(extension:string)=>({mimeType:extension==='jpg'?'image/jpeg':'image/webp',data:readFileSync(new URL('../../scripts/fixtures/uniben-engineering-2026.'+extension,import.meta.url)).toString('base64')});
const getKey=async()=>importJWK(await imageProcessingPublicKey(secret),'EdDSA');
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('private image processing on existing free hosting',()=>{
  it.each(['jpg','webp'])('retains exact physical rows and merged laboratory spans in %s with signed service requests',async extension=>{
    const fetcher=vi.fn(async(url:string|URL|Request,options?:RequestInit)=>{
      expect(url).toBe(imageProcessorURL);
      return privateTimetableImage(new Request(String(url),options),getKey);
    });vi.stubGlobal('fetch',fetcher);
    const source=media(extension),deadline=Date.now()+150000;
    const layout=await remoteTimetableLayout(env,source,deadline);
    expect(layout).toMatchObject({mimeType:'image/png',timeColumnCount:10,levelRowCount:25});
    const rows=await remoteTimetableRows(env,source,10,levels,days,'200',deadline);
    expect(rows?.map(row=>row.day)).toEqual(days);
    expect(rows?.[0]?.cells.slice(0,2)).toEqual([{from:0,to:2},{from:2,to:6}]);
    expect(rows?.[2]?.cells).toContainEqual({from:7,to:9});
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(source).toEqual(media(extension));
    const publicKey=await imageProcessingPublicKey(secret);
    expect(publicKey).not.toHaveProperty('d');expect(JSON.stringify(publicKey)).not.toContain(secret);
  });
  it('rejects unsigned, forged, expired and altered-body requests before processing',async()=>{
    const body=JSON.stringify({operation:'layout',media:media('jpg')}),token=await imageProcessingToken(secret,body);
    for(const authorization of ['', 'Bearer invalid','Bearer '+await imageProcessingToken('another-private-test-secret-'.repeat(3),body)]) {
      expect((await privateTimetableImage(new Request(imageProcessorURL,{method:'POST',headers:{authorization},body}),getKey)).status).toBe(401);
    }
    expect((await privateTimetableImage(new Request(imageProcessorURL,{method:'POST',headers:{authorization:'Bearer '+token},body:body+' '}),getKey)).status).toBe(401);
    const now=Date.now();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now-120000);
    const expired=await imageProcessingToken(secret,body);vi.useRealTimers();
    expect((await privateTimetableImage(new Request(imageProcessorURL,{method:'POST',headers:{authorization:'Bearer '+expired},body}),getKey)).status).toBe(401);
  });
  it('preserves the full file and reports an unavailable processor without accepting partial rows',async()=>{
    vi.stubGlobal('fetch',async()=>new Response(null,{status:503}));
    await expect(remoteTimetableLayout(env,media('jpg'),Date.now()+150000)).rejects.toMatchObject({reason:'AI_PROVIDER_BUSY'});
    vi.stubGlobal('fetch',async()=>Response.json({rows:[{day:1,cells:[{from:0,to:1}],media:{mimeType:'image/png',data:'YQ=='}}]}));
    await expect(remoteTimetableRows(env,media('jpg'),10,levels,days,'100')).rejects.toMatchObject({reason:'AI_INCOMPLETE_SCHEDULE'});
  });
  it('packs every requested day into one private image without changing physical cell spans',async()=>{
    vi.stubGlobal('fetch',(url:string|URL|Request,init?:RequestInit)=>privateTimetableImage(new Request(String(url),init),getKey));
    const rows=await remoteTimetableRows(env,media('jpg'),10,levels,days,'200',Date.now()+150000,true);
    expect(rows?.map(row=>row.day)).toEqual(days);expect(rows?.batch).toMatchObject({mimeType:'image/png'});
    expect(rows?.[0]?.cells.slice(0,2)).toEqual([{from:0,to:2},{from:2,to:6}]);
    const bytes=Buffer.from(rows!.batch!.data,'base64'),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
    expect(view.getUint32(16)*view.getUint32(20)).toBeLessThanOrEqual(4_000_000);
  });
  it('straightens a photographed ruled timetable before selecting complete physical rows',async()=>{
    vi.stubGlobal('fetch',(url:string|URL|Request,init?:RequestInit)=>privateTimetableImage(new Request(String(url),init),getKey));
    const source={mimeType:'image/jpeg',data:readFileSync(new URL('../../scripts/fixtures/uniben-engineering-2026-photo.jpg',import.meta.url)).toString('base64')};
    const layout=await remoteTimetableLayout(env,source,Date.now()+150000);
    expect(layout).toMatchObject({timeColumnCount:10,levelRowCount:25});
    const rows=await remoteTimetableRows(env,source,10,levels,days,'100',Date.now()+150000,true);
    expect(rows?.map(row=>row.day)).toEqual(days);
    expect(rows?.[0]?.cells).toContainEqual({from:4,to:6});
    expect(rows?.[1]?.cells.slice(0,2)).toEqual([{from:0,to:2},{from:2,to:3}]);
    expect(rows?.batch).toMatchObject({mimeType:'image/png'});
  },15000);
});
