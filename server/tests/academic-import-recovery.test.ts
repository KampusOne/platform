import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseOrRecoverAcademicImport } from '../src/lib/academic-import-recovery';
import { generateAI, type AIInput } from '../src/lib/ai-provider';
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
const response=(day:number)=>({labels:structuredClone(labels[day]),coverage:{complete:true,uncertain:[]}});
const dayOf=(request:AIInput)=>names.findIndex(name=>request.prompt.includes('for '+name+'.'));
beforeEach(()=>{vi.mocked(generateAI).mockReset().mockImplementation(async(_env,request)=>({text:JSON.stringify(response(dayOf(request))),provider:'workers-ai'}));});
describe('one-import private cell transcription',()=>{
  it('assembles all five selected rows under the same deadline without asking the model for clocks or row selection',async()=>{
    const request=input(),result=await parseOrRecoverAcademicImport({},request,broken(),'','class',{level:'200'});
    expect(result.entries).toHaveLength(20);expect(generateAI).toHaveBeenCalledTimes(5);
    expect(vi.mocked(generateAI).mock.calls.every(([,call])=>call.deadline===request.deadline&&call.media?.data!==image&&call.media?.mimeType==='image/png')).toBe(true);
    expect(result.entries).toContainEqual(expect.objectContaining({courseCode:'GST212',dayOfWeek:3,startsAt:'15:00',endsAt:'17:00'}));
  });
  it.each(['uncertain','missing-panel','wrong-level'])('rejects the entire week on a %s cell read',async failure=>{
    vi.mocked(generateAI).mockImplementation(async(_env,request)=>{const day=dayOf(request),value=response(day);
      if(day===4){if(failure==='uncertain')value.coverage.complete=false;else if(failure==='missing-panel')value.labels.pop();else value.labels[0]='100';}
      return{text:JSON.stringify(value),provider:'workers-ai'};});
    await expect(parseOrRecoverAcademicImport({},input(),broken(),'','class',{level:'200'})).rejects.toMatchObject({reason:'AI_INCOMPLETE_SCHEDULE'});
  });
  it('filters selected courses only after reading every physical cell',async()=>{
    const result=await parseOrRecoverAcademicImport({},input(),broken(),'','class',{level:'200',courseCodes:['GET211']});
    expect(result.entries).toHaveLength(5);expect(generateAI).toHaveBeenCalledTimes(5);
    expect(result.entries.filter(entry=>(entry as {courseCode:string}).courseCode)).toHaveLength(3);
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
});
