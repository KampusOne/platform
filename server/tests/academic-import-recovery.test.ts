import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateAcademicImport,parseOrRecoverAcademicImport } from '../src/lib/academic-import-recovery';
import {AIProviderError} from '../src/lib/ai-error';
import { generateAI, type AIInput } from '../src/lib/ai-provider';
import * as remoteImages from '../src/lib/remote-timetable-image';
import {timetableImageRows} from '../src/lib/timetable-image-grid';
vi.mock('../src/lib/ai-provider',()=>({generateAI:vi.fn()}));
const source=JSON.parse(readFileSync(new URL('../../scripts/fixtures/uniben-engineering-2026.json',import.meta.url),'utf8'));
const names=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const image=readFileSync(new URL('../../scripts/fixtures/uniben-engineering-2026.jpg',import.meta.url)).toString('base64');
const labels=[[],
  ['200','EMA281/GET209','200 LEVEL LABORATORY (ELA201)','','CVE211','',''],
  ['200','','EEE211/GET201','ECP281/GET211','ENT211','GET205/MEE361(CO)','','PRE211',''],
  ['200','MEE211/GET207','ECP281/GET211','200 LEVEL LABORATORY (ELA201)','','GST212','CVE211'],
  ['200','','','EEE211/GET201','GET203/MEE221','MEE211/GET207','PRE211',''],
  ['200','','','ECP281/GET211','EMA281/GET209','','GET205/MEE361(CO)','','',''],
];
const input=():AIInput=>({mode:'timetable',prompt:'',media:{mimeType:'image/jpeg',data:image},deadline:Date.now()+150000});
const broken=()=>{const value=structuredClone(source);value.grid.rows[2].level='100';return JSON.stringify(value);};
const response=(day:number)=>({labels:Object.fromEntries(labels[day]!.map((label,panel)=>[String(panel),label])),coverage:{complete:true,uncertain:[]}});
const dayOf=(request:AIInput)=>names.findIndex(name=>request.prompt.includes('for '+name+'.'));
beforeEach(()=>{vi.mocked(generateAI).mockReset().mockImplementation(async(_env,request)=>({text:JSON.stringify(response(dayOf(request))),provider:'workers-ai'}));});
describe('one-import private cell transcription',{timeout:30000},()=>{
  it('rereads only a day whose batch panel inventory is malformed and still verifies the full week',async()=>{
    const request={...input(),provider:'groq' as const},crops=timetableImageRows(request.media!,10,['100','200','300','400','500'],[1,2,3,4,5],'200')!;
    const remote=vi.spyOn(remoteImages,'remoteTimetableRows').mockResolvedValue(Object.assign(crops,{batch:{mimeType:'image/png',data:'YQ=='}}));
    try {
      vi.mocked(generateAI).mockImplementation(async(_env,call)=>{
        if(call.prompt.startsWith('Transcribe this contact sheet')){const byDay=Object.fromEntries([1,2,3,4,5].map(day=>[String(day),response(day).labels]));byDay['5']!['10']='';return{text:JSON.stringify({labels:byDay,coverage:{complete:true,uncertain:[]}}),provider:'groq'};}
        return{text:JSON.stringify(response(dayOf(call))),provider:'groq'};
      });
      const result=await parseOrRecoverAcademicImport({TIMETABLE_IMAGE_PROCESSOR_URL:'https://agents.kampusone.app/internal-processing/timetable-image'},request,broken(),'','class',{level:'200'});
      expect(result.entries).toHaveLength(20);expect(generateAI).toHaveBeenCalledTimes(2);
      const reread=vi.mocked(generateAI).mock.calls[1]![1];expect(reread.prompt).toContain('for Friday.');expect(reread.deadline).toBe(request.deadline);
      expect(result.entries).toContainEqual(expect.objectContaining({courseCode:'GST212',dayOfWeek:3,startsAt:'15:00',endsAt:'17:00'}));
    }finally{remote.mockRestore();}
  });
  it('rereads an incomplete calendar once through the independent fallback under the original deadline',async()=>{
    const full={documentType:'academic_calendar',entries:[],events:[{title:'Exams',startsOn:'2026-11-05',endsOn:'2026-11-09',semester:''}],warnings:[],coverage:{complete:true,daysRead:[],rowCount:1,uncertain:[]}};
    vi.mocked(generateAI).mockResolvedValueOnce({text:JSON.stringify({...full,coverage:{...full.coverage,complete:false}}),provider:'groq'})
      .mockResolvedValueOnce({text:JSON.stringify(full),provider:'gateway'});
    const deadline=Date.now()+150000,env={AI_ASSISTANT_ENABLED:'true',JWT_SECRET:'test-secret-'.repeat(4),TIMETABLE_IMAGE_PROCESSOR_URL:'https://agents.kampusone.app/internal-processing/timetable-image'};
    const result=await generateAcademicImport(env,{mode:'timetable',prompt:'Read all dates',deadline},'','calendar');
    expect(result.provider).toBe('gateway');expect(result.extracted.events).toHaveLength(1);expect(generateAI).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generateAI).mock.calls[1]![1]).toMatchObject({provider:'gateway',deadline,prompt:'Read all dates'});
  });
  it('never loops or returns a partial calendar when the independent reread is incomplete',async()=>{
    const partial={documentType:'academic_calendar',entries:[],events:[],warnings:[],coverage:{complete:false,daysRead:[],rowCount:0,uncertain:[]}};
    vi.mocked(generateAI).mockResolvedValue({text:JSON.stringify(partial),provider:'gateway'});
    const env={AI_ASSISTANT_ENABLED:'true',JWT_SECRET:'test-secret-'.repeat(4),TIMETABLE_IMAGE_PROCESSOR_URL:'https://agents.kampusone.app/internal-processing/timetable-image'};
    await expect(generateAcademicImport(env,{mode:'timetable',prompt:'Read',deadline:Date.now()+150000},'','calendar')).rejects.toMatchObject({reason:'AI_INCOMPLETE_SCHEDULE'});
    expect(generateAI).toHaveBeenCalledTimes(1);
  });
  it('retries a transient compact layout failure once and preserves the full import deadline for the cells',async()=>{
    const value=structuredClone(source);value.coverage={complete:false,daysRead:[],rowCount:0,uncertain:[]};value.grid.rows=[];
    vi.mocked(generateAI).mockRejectedValueOnce(new AIProviderError(503,'AI_PROVIDER_BUSY','busy')).mockResolvedValueOnce({text:JSON.stringify(value),provider:'workers-ai'});
    const request=input(),result=await generateAcademicImport({},request,'','class',{level:'200'});
    expect(result.extracted.entries).toHaveLength(20);expect(generateAI).toHaveBeenCalledTimes(7);
    const calls=vi.mocked(generateAI).mock.calls.map(([,call])=>call);
    expect(calls.slice(0,2).every(call=>call.scheduleLayout&&call.media?.mimeType==='image/png'&&call.deadline!<request.deadline!)).toBe(true);
    expect(calls.slice(2).every(call=>call.deadline===request.deadline)).toBe(true);
  });
  it('assembles all five selected rows under the same deadline without asking the model for clocks or row selection',async()=>{
    const request=input(),result=await parseOrRecoverAcademicImport({},request,broken(),'','class',{level:'200'});
    expect(result.entries).toHaveLength(20);expect(generateAI).toHaveBeenCalledTimes(5);
    expect(vi.mocked(generateAI).mock.calls.every(([,call])=>call.deadline===request.deadline&&call.media?.data!==image&&call.media?.mimeType==='image/png')).toBe(true);
    expect(result.entries).toContainEqual(expect.objectContaining({courseCode:'GST212',dayOfWeek:3,startsAt:'15:00',endsAt:'17:00'}));
  });
  it('bounds simultaneous day reads while still assembling every requested weekday',async()=>{
    let active=0,peak=0;
    vi.mocked(generateAI).mockImplementation(async(_env,call)=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return{text:JSON.stringify(response(dayOf(call))),provider:'gateway'};});
    const result=await parseOrRecoverAcademicImport({},input(),broken(),'','class',{level:'200'});
    expect(result.entries).toHaveLength(20);expect(generateAI).toHaveBeenCalledTimes(5);expect(peak).toBeLessThanOrEqual(2);
  });
  it('stops starting more day reads after a failure and rejects the whole week',async()=>{
    vi.mocked(generateAI).mockImplementation(async(_env,call)=>{const day=dayOf(call);if(day===1)throw new AIProviderError(422,'AI_INCOMPLETE_SCHEDULE','unreadable source');await new Promise(resolve=>setTimeout(resolve,5));return{text:JSON.stringify(response(day)),provider:'gateway'};});
    await expect(parseOrRecoverAcademicImport({},input(),broken(),'','class',{level:'200'})).rejects.toMatchObject({reason:'AI_INCOMPLETE_SCHEDULE'});
    expect(generateAI).toHaveBeenCalledTimes(2);
  });
  it.each(['uncertain','missing-panel','wrong-level'])('rejects the entire week on a %s cell read',async failure=>{
    vi.mocked(generateAI).mockImplementation(async(_env,request)=>{const day=dayOf(request),value=response(day);
      if(day===4){if(failure==='uncertain')value.coverage.complete=false;else if(failure==='missing-panel')delete value.labels['7'];else value.labels['0']='100';}
      return{text:JSON.stringify(value),provider:'workers-ai'};});
    await expect(parseOrRecoverAcademicImport({},input(),broken(),'','class',{level:'200'})).rejects.toMatchObject({reason:'AI_INCOMPLETE_SCHEDULE'});
  });
  it('rereads a malformed panel inventory once without shifting labels or changing the import deadline',async()=>{
    let mondayReads=0;
    vi.mocked(generateAI).mockImplementation(async(_env,request)=>{
      const day=dayOf(request),value=response(day);
      if(day===1&&mondayReads++===0)value.labels['7']='';
      return {text:JSON.stringify(value),provider:'workers-ai'};
    });
    const request=input(),result=await parseOrRecoverAcademicImport({},request,broken(),'','class',{level:'200'});
    expect(result.entries).toHaveLength(20);expect(generateAI).toHaveBeenCalledTimes(6);
    expect(result.entries).toContainEqual(expect.objectContaining({courseCode:'CVE211',dayOfWeek:1,startsAt:'15:00',endsAt:'16:00'}));
    const retry=vi.mocked(generateAI).mock.calls.map(([,call])=>call).find(call=>call.prompt.includes('previous response'))!;
    expect(retry.deadline).toBeLessThanOrEqual(request.deadline!);expect(retry.media).toEqual(vi.mocked(generateAI).mock.calls[0]![1].media);
  });
  it('filters selected courses only after reading every physical cell',async()=>{
    const result=await parseOrRecoverAcademicImport({},input(),broken(),'','class',{level:'200',courseCodes:['GET211']});
    expect(result.entries).toHaveLength(5);expect(generateAI).toHaveBeenCalledTimes(5);
    expect(result.entries.filter(entry=>(entry as {courseCode:string}).courseCode)).toHaveLength(3);
  });
  it('cannot turn a pixel-certified empty cell into a hallucinated extra class',async()=>{
    vi.mocked(generateAI).mockImplementation(async(_env,request)=>{
      const day=dayOf(request),value=response(day);
      if(day===1)value.labels['3']='CHM101';
      return{text:JSON.stringify(value),provider:'groq'};
    });
    const result=await parseOrRecoverAcademicImport({},input(),broken(),'','class',{level:'200'});
    expect(result.entries).toHaveLength(20);expect(result.entries.some(entry=>/CHM101/.test(String((entry as {title:string}).title)))).toBe(false);
  });
  it('does not begin more inference near the deadline or without a level selection',async()=>{
    for(const [request,scope,reason] of [[{...input(),deadline:Date.now()+1000},{level:'200'},'AI_INCOMPLETE_SCHEDULE'],[input(),{},'AI_LEVEL_REQUIRED']] as const)
      await expect(parseOrRecoverAcademicImport({},request,broken(),'','class',scope)).rejects.toMatchObject({reason});
    expect(generateAI).not.toHaveBeenCalled();
  });
  it('uses physical spans even if the whole-image response claims plausible wrong clocks',async()=>{
    const value=structuredClone(source);value.grid.rows[2].cells[3].to=8;value.grid.rows[2].cells[4].from=8;
    const result=await parseOrRecoverAcademicImport({},input(),JSON.stringify(value),'','class',{level:'200'});
    expect(result.entries).toContainEqual(expect.objectContaining({courseCode:'GST212',startsAt:'15:00',endsAt:'17:00'}));
  });
  it('rejects an omitted day inventory before transcription',async()=>{
    const value=structuredClone(source);value.grid.daysSeen.pop();
    await expect(parseOrRecoverAcademicImport({},input(),JSON.stringify(value),'','class',{level:'200'})).rejects.toMatchObject({reason:'AI_INCOMPLETE_SCHEDULE'});
    expect(generateAI).not.toHaveBeenCalled();
  });
  it('accepts unambiguous printed weekday labels and rejects unknown ones before transcription',async()=>{
    const value=structuredClone(source);value.grid.daysSeen=['MON','TUE','WED','THUR','FRI'];value.coverage.complete=false;
    expect((await parseOrRecoverAcademicImport({},input(),JSON.stringify(value),'','class',{level:'200'})).entries).toHaveLength(20);
    vi.mocked(generateAI).mockClear();value.grid.daysSeen[2]='sometime';
    await expect(parseOrRecoverAcademicImport({},input(),JSON.stringify(value),'','class',{level:'200'})).rejects.toMatchObject({reason:'AI_INCOMPLETE_SCHEDULE'});
    expect(generateAI).not.toHaveBeenCalled();
  });
});
