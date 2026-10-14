import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAcademicImport } from '../src/lib/academic-import';

const source = JSON.parse(readFileSync(new URL('../../scripts/fixtures/uniben-engineering-2026.json', import.meta.url), 'utf8'));
const parse = (value = structuredClone(source), level = '200', courseCodes?: string[]) => parseAcademicImport(JSON.stringify(value), '', 'class', {strict:true,scope:{level,...(courseCodes ? {courseCodes} : {})}});
describe('UNIBEN multi-level table extraction', () => {
  it('preserves all five days, merged laboratories, gaps and the late Wednesday classes', () => {
    const result = parse(), entries = result.entries as {courseCode:string;dayOfWeek:number;startsAt:string;endsAt:string}[];
    expect(entries).toHaveLength(20);
    expect([1,2,3,4,5].map(day => entries.filter(entry => entry.dayOfWeek===day).length)).toEqual([3,5,5,4,3]);
    expect(entries.filter(entry => entry.dayOfWeek===3)).toMatchObject([
      {courseCode:'MEE211/GET207',startsAt:'08:00',endsAt:'09:00'},
      {courseCode:'ECP281/GET211',startsAt:'09:00',endsAt:'10:00'},
      {courseCode:'',startsAt:'10:00',endsAt:'14:00'},
      {courseCode:'GST212',startsAt:'15:00',endsAt:'17:00'},
      {courseCode:'CVE211',startsAt:'17:00',endsAt:'18:00'},
    ]);
    expect(entries.some(entry => ['MTH101','PHY101','GST112'].includes(entry.courseCode))).toBe(false);
  });
  it('ignores model-proposed entry clocks and derives every time from the table geometry', () => {
    const broken = structuredClone(source);
    broken.entries = [{title:'GST212',courseCode:'GST212',dayOfWeek:3,startsAt:'13:00',endsAt:'14:00'}];
    expect((parse(broken).entries as {courseCode:string;startsAt:string}[]).find(entry => entry.courseCode==='GST212')?.startsAt).toBe('15:00');
  });
  it.each(['mixed-level','missing-day','missing-cell','overlapping-cell','shifted-cell','reversed-header','duplicate-day','incomplete','uncertainty','half-warning'])("rejects %s instead of exposing a half or incorrect review", failure => {
    const broken = structuredClone(source);
    if (failure==='mixed-level') broken.grid.rows[2].level='100';
    if (failure==='missing-day') broken.grid.rows.pop();
    if (failure==='missing-cell') broken.grid.rows[2].cells.pop();
    if (failure==='overlapping-cell') broken.grid.rows[2].cells[2].from=1;
    if (failure==='shifted-cell') broken.grid.rows[2].cells[3].from=7;
    if (failure==='reversed-header') broken.grid.timeSlots[7].endsAt='04:00';
    if (failure==='duplicate-day') broken.grid.rows[3].dayOfWeek=3;
    if (failure==='incomplete') broken.coverage.complete=false;
    if (failure==='uncertainty') broken.coverage.uncertain=['Friday could not be read'];
    if (failure==='half-warning') broken.warnings=['Import this partial schedule and scan the rest separately.'];
    expect(() => parse(broken)).toThrow();
  });
  it('requires a real level selection when multiple levels exist and rejects absent levels', () => {
    expect(() => parse(source,'')).toThrow('several levels');
    expect(() => parse(source,'600')).toThrow('not on this timetable');
  });
  it('filters selected slash-separated alternatives after transcription without changing their day or clock', () => {
    const entries = parse(source,'200',['GET211']).entries as {courseCode:string;dayOfWeek:number;startsAt:string;endsAt:string;title:string}[];
    expect(entries.filter(entry => entry.courseCode)).toMatchObject([
      {courseCode:'GET211',dayOfWeek:2,startsAt:'11:00',endsAt:'12:00'},
      {courseCode:'GET211',dayOfWeek:3,startsAt:'09:00',endsAt:'10:00'},
      {courseCode:'GET211',dayOfWeek:5,startsAt:'10:00',endsAt:'11:00'},
    ]);
    expect(entries.filter(entry => /LABORATORY/.test(entry.title))).toHaveLength(2);
  });
});
describe('complete list/calendar/exam extraction', () => {
  const entry = {title:'MTH201',courseCode:'MTH201',dayOfWeek:1,startsAt:'08:00',endsAt:'10:00'};
  const coverage = {complete:true,daysRead:[1],rowCount:1,uncertain:[]};
  it('accepts the real reader weekday-name response without changing its class or clocks',()=>{
    const value={documentType:'class_timetable',entries:[{...entry,lecturer:null,venue:'Lecture Hall 1'}],events:[],warnings:[],coverage:{...coverage,daysRead:['Monday']}};
    expect(parseAcademicImport(JSON.stringify(value),'','class',{strict:true}).entries).toMatchObject([{courseCode:'MTH201',dayOfWeek:1,startsAt:'08:00',endsAt:'10:00',lecturer:'',venue:'Lecture Hall 1'}]);
  });
  it.each([[['Funday']],[['Monday',1]],[['Tuesday']]])('rejects invalid, duplicate or mismatched weekday coverage %j',daysRead=>{
    expect(()=>parseAcademicImport(JSON.stringify({documentType:'class_timetable',entries:[entry],warnings:[],coverage:{...coverage,daysRead}}),'','class',{strict:true})).toThrow();
  });
  it('accepts a complete explicit class list and rejects missing coverage, invalid rows and empty success', () => {
    const full = {documentType:'class_timetable',entries:[entry],warnings:[],coverage};
    expect(parseAcademicImport(JSON.stringify(full),'','class',{strict:true}).entries).toHaveLength(1);
    for (const broken of [{...full,coverage:undefined},{...full,entries:[]},{...full,entries:[{...entry,endsAt:'07:00'}]}, {...full,coverage:{...coverage,daysRead:[1,3]}}])
      expect(() => parseAcademicImport(JSON.stringify(broken),'','class',{strict:true})).toThrow();
  });
  it('rejects a skipped calendar or exam row rather than certifying the readable subset', () => {
    const calendar = {documentType:'academic_calendar',entries:[],events:[{title:'Exams',startsOn:'2026-11-05',endsOn:'2026-11-09',semester:''},{title:'Unreadable',startsOn:'2026-02-30',endsOn:'2026-03-01',semester:''}],coverage:{...coverage,rowCount:2,daysRead:[]}};
    expect(() => parseAcademicImport(JSON.stringify(calendar),'','calendar',{strict:true})).toThrow();
    const exam = {documentType:'exam_timetable',entries:[{title:'MTH201',courseCode:'MTH201',date:'2026-11-05',startsAt:'09:00',endsAt:'11:00',venue:''},{title:'Missing date',startsAt:'09:00',endsAt:'11:00'}],coverage:{...coverage,rowCount:2,daysRead:[]}};
    expect(() => parseAcademicImport(JSON.stringify(exam),'','exam',{strict:true})).toThrow();
  });
});
