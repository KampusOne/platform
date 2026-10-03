import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import type {Context,Next} from 'hono';
import type {PGlite} from '@electric-sql/pglite';
import {app} from '../src/app';
import type {Bindings} from '../src/types';
import {createTestDatabase,testDatabaseAdapter,testSqlClient} from './helpers/database';
let db:PGlite;
const campus=crypto.randomUUID(),otherCampus=crypto.randomUUID(),publisher=crypto.randomUUID(),exact=crypto.randomUUID(),similar=crypto.randomUUID(),underscore=crypto.randomUUID(),blocked=crypto.randomUUID(),foreign=crypto.randomUUID(),inactive=crypto.randomUUID();
const identities=[publisher,exact,similar,underscore,blocked,foreign,inactive];
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(db),sqlClient:()=>testSqlClient(db),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
vi.mock('../src/middleware/auth',()=>({requireAuth:async(_c:Context,next:Next)=>next(),currentUser:(c:Context)=>{const actor=c.req.header('x-user')??publisher;return {id:actor,email:'test-only@example.invalid',universityId:actor===foreign?otherCampus:campus,roles:['STUDENT'],operatorRoles:[]};}}));
const env:Bindings={ENVIRONMENT:'local',ALLOWED_ORIGINS:'https://app.example.invalid',PUBLIC_API_ORIGIN:'https://api.example.invalid',MINIMUM_APP_VERSION:'0.1.0',MAINTENANCE_MODE:'false',ACADEMIC_CORE_ENABLED:'true',SOCIAL_FEED_ENABLED:'true',MARKETPLACE_ENABLED:'false',PHASE_2_SCHEMA_READY:'true',PHASE_3_SCHEMA_READY:'false',UNIFIED_SCHEMA_READY:'true',PAYMENTS_ENABLED:'false',AI_ASSISTANT_ENABLED:'false',JWT_SECRET:'test-only-signing-key-never-use-in-production-123456',KYC_FINGERPRINT_SECRET:'test-only-fingerprint-key-never-use-in-production-123456'};
const request=(path:string,method='GET',body?:unknown,actor=publisher)=>app.request('https://api.example.invalid/v1'+path,{method,headers:{'x-user':actor,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},env);
async function checked(response:Response,status=200){const data=await response.json();expect({status:response.status,...(response.status===status?{}:{data})}).toEqual({status});return data;}
async function publish(category:'EVENT'|'SPORTS'|'OPPORTUNITY',extra:Record<string,unknown>={},actor=publisher){const draft={requestId:crypto.randomUUID(),category,title:category+' campus update',description:'An ordinary student shares a useful update.',...(category==='OPPORTUNITY'?{deadline:'2027-10-20T16:00:00+01:00',registrationUrl:'https://example.invalid/apply'}:{startsAt:'2027-10-15T10:00:00+01:00',venue:'Lecture theatre 1'}),...extra};const result=await checked(await request('/student/feed/activity','POST',draft,actor),201);return {draft,id:result.id};}
async function seedPost(author:string,body:string,visibility='PUBLIC',status='PUBLISHED'){
 const school=author===foreign?otherCampus:campus;
 const sources=await db.query<{id:string}>("insert into public.content_sources(university_id,name,owner_user_id) values($1,$2,$3) on conflict(university_id,name) do update set owner_user_id=excluded.owner_user_id returning id",[school,'test-source:'+author,author]);
 const post=await db.query<{id:string}>("insert into public.feed_posts(university_id,source_id,author_user_id,category,title,summary,body,audience,status,published_at) values($1,$2,$3,'UPDATE','Hashtag fixture',$4,$4,$5::jsonb,$6,now()) returning id",[school,sources.rows[0].id,author,body,JSON.stringify({studentPost:true,visibility}),status]);return post.rows[0].id;
}
beforeAll(async()=>{db=await createTestDatabase();for(const [i,id]of[campus,otherCampus].entries())await db.query("insert into public.universities(id,name,slug,updated_at) values($1,$2,$3,now())",[id,'Activity campus '+i,'activities-campus-'+i]);const handles=['newsletter','warrior','warriora','war_rior','warriorblocked','warriorforeign','warriorinactive'];for(const[i,id]of identities.entries()){await db.query("insert into public.users(id,email,password_hash,updated_at) values($1,$2,'test-only',now())",[id,'activity-user-'+i+'@example.invalid']);await db.query("insert into public.profiles(id,user_id,university_id,username,display_name,profile_image_url,updated_at) values(gen_random_uuid(),$1,$2,$3,$4,$5,now())",[id,id===foreign?otherCampus:campus,handles[i],'Activity student '+i,i===1?'https://images.example.invalid/warrior.jpg':null]);}await db.query('update public.users set deleted_at=now() where id=$1',[inactive]);await db.query('insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)',[publisher,blocked]);},60000);
afterAll(async()=>db?.close());
describe('ordinary student campus publishing',()=>{
 it('publishes all activity categories through normal student access and includes their real fields in the All feed',async()=>{
  const event=await publish('EVENT',{registrationUrl:'https://example.invalid/event'}),sports=await publish('SPORTS'),opportunity=await publish('OPPORTUNITY');
  const all=await checked(await request('/student/feed'));
  for(const activity of[event,sports,opportunity]){const post=all.posts.find((post:any)=>post.id===activity.id);expect(post).toBeDefined();expect(post.category).toBe(activity.draft.category);expect(post.activity.venue).toBe(activity.draft.venue??null);expect(post.activity.registrationUrl).toBe(activity.draft.registrationUrl??null);expect(post.activity.deadline).toBe(activity.draft.deadline??null);}
  const onlyEvents=await checked(await request('/student/feed?category=EVENT'));expect(onlyEvents.posts.map((post:any)=>post.category)).toEqual(['EVENT']);
 });
 it('replays without duplicate posts and rejects a changed request',async()=>{
  const event=await publish('EVENT');const replay=await checked(await request('/student/feed/activity','POST',event.draft));expect(replay.id).toBe(event.id);
  await checked(await request('/student/feed/activity','POST',{...event.draft,title:'A conflicting changed title'}),409);
  const stored=await db.query('select id from public.feed_posts where author_user_id=$1 and client_request_id=$2',[publisher,event.draft.requestId]);expect(stored.rows).toEqual([{id:event.id}]);
  const parallelDraft={...event.draft,requestId:crypto.randomUUID(),title:'Concurrent retry event'};const concurrent=await Promise.all([request('/student/feed/activity','POST',parallelDraft),request('/student/feed/activity','POST',parallelDraft)]);const results=await Promise.all(concurrent.map(async response=>{expect([200,201]).toContain(response.status);return response.json();}));expect(results[0].id).toBe(results[1].id);expect((await db.query('select id from public.feed_posts where author_user_id=$1 and client_request_id=$2',[publisher,parallelDraft.requestId])).rows).toHaveLength(1);
 });
 it('validates venue/time, opportunity link/deadline and media ownership before publishing',async()=>{
  await checked(await request('/student/feed/activity','POST',{requestId:crypto.randomUUID(),category:'EVENT',title:'Student event',description:'An event without venue/time.'}),400);
  await checked(await request('/student/feed/activity','POST',{requestId:crypto.randomUUID(),category:'SPORTS',title:'Student sport',description:'Sport without time.',venue:'Sports complex'}),400);
  await checked(await request('/student/feed/activity','POST',{requestId:crypto.randomUUID(),category:'OPPORTUNITY',title:'Student opportunity',description:'No deadline or link.'}),400);
  await checked(await request('/student/feed/activity','POST',{requestId:crypto.randomUUID(),category:'OPPORTUNITY',title:'Unsafe link opportunity',description:'Bad scheme.',deadline:'2027-12-01T00:00:00Z',registrationUrl:'javascript:alert(1)'}),400);
  const ownImage=crypto.randomUUID(),otherImage=crypto.randomUUID(),ownVideo=crypto.randomUUID();for(const [id,owner,mime]of[[ownImage,publisher,'image/jpeg'],[otherImage,exact,'image/png'],[ownVideo,publisher,'video/mp4']])await db.query("insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name) values($1,$2,$3,'post',$4,$5,10,'Synthetic media')",[id,owner,campus,'test-only/'+id,mime]);
  const draft={requestId:crypto.randomUUID(),category:'EVENT',title:'Photo activity',description:'A photo from this account.',venue:'Main hall',startsAt:'2027-10-20T12:00:00Z'};
  await checked(await request('/student/feed/activity','POST',{...draft,mediaIds:[otherImage]}),400);
  await checked(await request('/student/feed/activity','POST',{...draft,mediaIds:[ownVideo]}),400);
  await checked(await request('/student/feed/activity','POST',{...draft,mediaIds:[ownImage,ownImage]}),400);
  const saved=await checked(await request('/student/feed/activity','POST',{...draft,mediaIds:[ownImage]}),201);const post=await checked(await request('/student/feed/'+saved.id));expect(post.post.image_url).toBe('https://api.example.invalid/v1/media/'+ownImage);expect(post.post.media).toEqual([{url:'https://api.example.invalid/v1/media/'+ownImage,type:'image/jpeg'}]);
 });
});
describe('live mention and hashtag discovery',()=>{
 it('ranks the exact handle first, returns avatars, treats underscores literally and omits foreign/blocked/inactive profiles',async()=>{
  const result=await checked(await request('/student/feed/mentions?q=@warrior'));expect(result.profiles[0].user_id).toBe(exact);expect(result.profiles[0].profile_image_url).toBe('https://images.example.invalid/warrior.jpg');expect(result.profiles.map((profile:any)=>profile.user_id)).toEqual([exact,similar]);
  const underscoreResult=await checked(await request('/student/feed/mentions?q=war_'));expect(underscoreResult.profiles.map((profile:any)=>profile.user_id)).toEqual([underscore]);
  expect((await checked(await request('/student/feed/mentions?q=%25'))).profiles).toEqual([]);
  expect((await checked(await request('/people/by-username/WARRIOR'))).id).toBe(exact);
  await checked(await request('/people/by-username/warriorforeign'),404);
  await checked(await request('/people/by-username/warriorblocked'),404);
  await checked(await request('/people/by-username/warriorinactive'),404);
 });
 it('counts distinct live visible posts with existing hashtags and keeps exact tag filtering consistent',async()=>{
  const first=await seedPost(publisher,'#KampusOne #KampusOne and #KampusOneBuild');const publicForeign=await seedPost(foreign,'#KampusOne public post');await seedPost(foreign,'#KampusOne private post','CAMPUS');await seedPost(blocked,'#KampusOne blocked post');await seedPost(publisher,'#KampusOne unpublished post','PUBLIC','DRAFT');await seedPost(publisher,'Only a URL fragment https://example.invalid/path#KampusOne');
  const tags=await checked(await request('/student/feed/hashtags?q=Kampus'));expect(tags.hashtags).toContainEqual({tag:'kampusone',count:2});expect(tags.hashtags).toContainEqual({tag:'kampusonebuild',count:1});
  const exactTag=await checked(await request('/student/feed?q=%23KampusOne'));expect(new Set(exactTag.posts.map((post:any)=>post.id))).toEqual(new Set([first,publicForeign]));
  expect((await checked(await request('/student/feed/hashtags?q=%25'))).hashtags).toEqual([]);
 });
 it('notifies exact mentioned accounts once on replay, omits blocks and avoids interpreting email handles as mentions',async()=>{
  const draft={requestId:crypto.randomUUID(),body:'Thanks @warrior and @Warrior. Also @warriora, @warriorblocked and @warriorforeign. This is an email: team@war_rior.'};
  const post=await checked(await request('/student/feed','POST',draft),201);expect((await checked(await request('/student/feed','POST',draft))).id).toBe(post.id);
  const notices=await db.query<{user_id:string;actor_user_id:string}>('select user_id,actor_user_id from public.in_app_notifications where dedupe_key like $1',['post-mention:'+post.id+':%']);expect(new Set(notices.rows.map(n=>n.user_id))).toEqual(new Set([exact,similar,foreign]));expect(notices.rows.every(n=>n.actor_user_id===publisher)).toBe(true);
  const pushes=await db.query('select user_id from app_private.notification_outbox where dedupe_key like $1',['post-mention:'+post.id+':%']);expect(pushes.rows).toHaveLength(3);
  await checked(await request('/student/feed','POST',{...draft,body:'Changed content'}),409);
 });
});
