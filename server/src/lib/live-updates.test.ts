import {describe,it,expect,vi} from 'vitest';
import {LiveUser,liveScope,validLiveChange,publishUserReads} from './live-updates';
import {parseExamDocument} from './exam-schedule';
import {parseScheduleDocument} from './schedule-document';
const uuid='11111111-1111-4111-8111-111111111111';
describe('private invalidation transport',()=>{
 it('isolates users and institutions and forbids financial/raw content channels',()=>{
  expect(liveScope(uuid,'A')).not.toBe(liveScope(uuid,'B'));
  expect(validLiveChange({id:'event',prefixes:['/v1/messages/inbox','/v1/messages/threads/'+uuid]})).toBe(true);
  for(const prefix of ['/v1/payments','/v1/messages/threads/another-user','/v1/agents/location?latitude=5'])expect(validLiveChange({id:'event',prefixes:[prefix]})).toBe(false);
 });
 it('broadcasts one ordered event per id and expires authorization leases',async()=>{
  const state=new Map<string,unknown>(),sent:string[]=[];
  const live={deserializeAttachment:()=>({expiresAt:Date.now()+1000}),send:(v:string)=>sent.push(v),close:vi.fn()};
  const expired={deserializeAttachment:()=>({expiresAt:0}),send:vi.fn(),close:vi.fn()};
  const ctx={storage:{get:async(key:string)=>state.get(key),put:async(key:string,value:unknown)=>{state.set(key,value);},setAlarm:vi.fn()},getWebSockets:()=>[live,expired]} as unknown as DurableObjectState;
  const hub=new LiveUser(ctx),change={id:'one',prefixes:['/v1/messages/inbox']};
  expect((await hub.fetch(new Request('https://live.internal/change',{method:'POST',body:JSON.stringify(change)}))).status).toBe(204);
  await hub.fetch(new Request('https://live.internal/change',{method:'POST',body:JSON.stringify(change)}));
  expect(sent).toHaveLength(1);expect(JSON.parse(sent[0]!)).toEqual({type:'change',sequence:1,prefixes:change.prefixes});
  expect(expired.send).not.toHaveBeenCalled();expect(expired.close).toHaveBeenCalled();
  await hub.alarm();expect(ctx.storage.setAlarm).toHaveBeenCalled();
 });
 it('stays disabled without the reviewed binding and never publishes invalid resources',async()=>{
  const fetch=vi.fn(),env={LIVE_UPDATES_ENABLED:'true',LIVE_USERS:{idFromName:vi.fn((v:string)=>v),get:()=>({fetch})}};
  await publishUserReads(env as never,uuid,'A',{id:'event',prefixes:['/v1/payments/balance']});expect(fetch).not.toHaveBeenCalled();
  await publishUserReads(env as never,uuid,'A',{id:'event',prefixes:['/v1/messages/inbox']});expect(fetch).toHaveBeenCalledTimes(1);
 });
});
describe('independent academic extraction',()=>{
 it('deduplicates exam rows and refuses invalid dates without turning papers into weekly classes',()=>{
  const paper={title:'CPE 250',courseCode:'CPE 250',date:'2026-11-05',startsAt:'09:00',endsAt:'11:00',venue:'LT 1'};
  const result=parseExamDocument(JSON.stringify({entries:[paper,paper,{...paper,date:'2026-02-30'}]}));
  expect(result.entries).toHaveLength(1);expect(result.documentType).toBe('exam_timetable');expect(result.warnings).toHaveLength(2);
 });
 it('keeps calendar dates separate and deduplicates overlapping copies of the same event',()=>{
  const event={title:'Examinations',startsOn:'2026-11-01',endsOn:'2026-11-20',semester:'Second semester'};
  const result=parseScheduleDocument(JSON.stringify({documentType:'academic_calendar',entries:[{title:'First semester'}],events:[event,event]}));
  expect(result.entries).toEqual([]);expect(result.events).toHaveLength(1);expect(result.warnings).toHaveLength(1);
 });
});
