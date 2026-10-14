import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseOrRecoverAcademicImport } from '../src/lib/academic-import-recovery';
import { generateAI, type AIInput } from '../src/lib/ai-provider';
vi.mock('../src/lib/ai-provider',()=>({generateAI:vi.fn()}));
const source=JSON.parse(readFileSync(new URL('../../scripts/fixtures/uniben-engineering-2026.json',import.meta.url),'utf8'));
const names=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const input=():AIInput=>({mode:'timetable',prompt:'',media:{mimeType:'image/jpeg',data:'PRIVATE_PIXELS'},deadline:Date.now()+150000});
const broken=()=>{const value=structuredClone(source);value.grid.rows[2].level='100';return JSON.stringify(value);};
function part(day:number){return {...structuredClone(source),coverage:{complete:true,daysRead:[day],rowCount:1,uncertain:[]},grid:{...structuredClone(source.grid),daysSeen:[day],rows:[structuredClone(source.grid.rows[day-1])]}};}
beforeEach(()=>{vi.mocked(generateAI).mockReset().mockImplementation(async(_env,request)=>{const day=names.findIndex(name=>request.prompt.includes('ONLY the '+name+' row'));return{text:JSON.stringify(part(day)),provider:'workers-ai'};});});
describe('one-import focused day recovery',()=>{
  it('assembles all five selected rows and retains the original shared deadline',async()=>{
    const request=input(),result=await parseOrRecoverAcademicImport({},request,broken(),'','class',{level:'200'});
    expect(result.entries).toHaveLength(20);expect(generateAI).toHaveBeenCalledTimes(5);
    expect(vi.mocked(generateAI).mock.calls.every(([,call])=>call.deadline===request.deadline&&call.media===request.media)).toBe(true);
    expect(result.entries).toContainEqual(expect.objectContaining({courseCode:'GST212',dayOfWeek:3,startsAt:'15:00',endsAt:'17:00'}));
  });
  it('rejects the entire recovery if any day is unreadable',async()=>{
    vi.mocked(generateAI).mockImplementation(async(_env,request)=>{const day=names.findIndex(name=>request.prompt.includes('ONLY the '+name+' row')),value=part(day);if(day===4)value.coverage.complete=false;return{text:JSON.stringify(value),provider:'workers-ai'};});
    await expect(parseOrRecoverAcademicImport({},input(),broken(),'','class',{level:'200'})).rejects.toMatchObject({reason:'AI_INCOMPLETE_SCHEDULE'});
  });
  it('rejects conflicting time headers instead of joining shifted classes',async()=>{
    vi.mocked(generateAI).mockImplementation(async(_env,request)=>{const day=names.findIndex(name=>request.prompt.includes('ONLY the '+name+' row')),value=part(day);if(day===2)value.grid.timeSlots[0].startsAt='07:00';return{text:JSON.stringify(value),provider:'workers-ai'};});
    await expect(parseOrRecoverAcademicImport({},input(),broken(),'','class',{level:'200'})).rejects.toThrow('disagreed');
  });
  it('applies course filtering only after assembling every full day',async()=>{
    const result=await parseOrRecoverAcademicImport({},input(),broken(),'','class',{level:'200',courseCodes:['GET211']});
    expect(result.entries).toHaveLength(5);expect(generateAI).toHaveBeenCalledTimes(5);
    expect(result.entries.filter(entry=>(entry as {courseCode:string}).courseCode)).toHaveLength(3);
  });
  it('does not start extra reads near the deadline or without an explicit row selection',async()=>{
    for(const [request,scope,reason] of [[{...input(),deadline:Date.now()+1000},{level:'200'},'AI_INCOMPLETE_SCHEDULE'],[input(),{},'AI_LEVEL_REQUIRED']] as const)
      await expect(parseOrRecoverAcademicImport({},request,broken(),'','class',scope)).rejects.toMatchObject({reason});
    expect(generateAI).not.toHaveBeenCalled();
  });
  it('corroborates a plausible but shifted clock even when the whole-grid response claims success',async()=>{
    const value=structuredClone(source);value.grid.rows[2].cells[3].to=8;value.grid.rows[2].cells[4].from=8;
    const result=await parseOrRecoverAcademicImport({},input(),JSON.stringify(value),'','class',{level:'200'});
    expect(result.entries).toContainEqual(expect.objectContaining({courseCode:'GST212',startsAt:'15:00',endsAt:'17:00'}));
    expect(generateAI).toHaveBeenCalledTimes(5);
  });
});
