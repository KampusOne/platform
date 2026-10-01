import { readFileSync } from "node:fs";
import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import { Hono,type Context,type Next } from "hono";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase,testDatabaseAdapter,testSqlClient } from "./helpers/database";
import { peopleRoutes } from "../src/routes/people";
import { agentRoutes } from "../src/routes/agents";
import { aiRoutes } from "../src/routes/ai";
import { runStudentTool,classDraftSchema } from "../src/lib/student-ai-tools";
import { AppError } from "../src/lib/errors";
import type { AuthenticatedUser,Bindings } from "../src/types";
let pg:PGlite;
vi.mock("../src/lib/database",()=>({database:()=>testDatabaseAdapter(pg),sqlClient:()=>testSqlClient(pg),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
const campus=crypto.randomUUID(),otherCampus=crypto.randomUUID(),student=crypto.randomUUID(),owner=crypto.randomUUID(),foreign=crypto.randomUUID();
const vendor=crypto.randomUUID(),tutor=crypto.randomUUID(),foreignTutor=crypto.randomUUID(),product=crypto.randomUUID();
vi.mock("../src/middleware/auth",()=>({currentUser:(c:Context)=>({id:c.req.header("x-user"),universityId:c.req.header("x-campus"),roles:["STUDENT"]}),requireAuth:async(c:Context,next:Next)=>c.req.header("x-user")?next():c.json({error:"Unauthorized"},401)}));
const env={UNIFIED_SCHEMA_READY:"true",PHASE_2_SCHEMA_READY:"true",PHASE_3_SCHEMA_READY:"true",TUTORIALS_ENABLED:"true",STORE_ENABLED:"true",AI_ASSISTANT_ENABLED:"true"} as Bindings;
const identity={id:student,universityId:campus,email:"student@example.invalid",roles:["STUDENT"],operatorRoles:[]} as AuthenticatedUser;
const app=new Hono().route("/people",peopleRoutes).route("/agents",agentRoutes).route("/ai",aiRoutes);
app.onError((e,c)=>c.json({error:e.message},e instanceof AppError?e.status:500));
async function request(path:string,method="GET",body?:unknown,user=student,uni=campus){return app.request(path,{method,headers:{"x-user":user,"x-campus":uni,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})},env);}
async function result(path:string,method="GET",body?:unknown,user=student,status=200){const r=await request(path,method,body,user);const data=await r.json();expect(r.status,JSON.stringify(data)).toBe(status);return data;}
beforeAll(async()=>{
 pg=await createTestDatabase();
 await pg.exec("create unique index test_agent_campus_unique on public.agent_profiles(id,university_id)");
 // Same storefront DDL as the production migration; no production rows or secrets.
 const commerce=readFileSync(new URL("../../database/neon/migrations/20260912200000_phase_3_commerce_foundation.sql",import.meta.url),"utf8");
 const storefront=commerce.match(/create table if not exists public\.vendor_storefronts \([\s\S]*?\n\);/); if(!storefront)throw new Error("Missing storefront schema");await pg.exec(storefront[0]);
 for(const [id,name]of[[campus,"Campus A"],[otherCampus,"Campus B"]])await pg.query("insert into universities(id,name,slug,updated_at)values($1::uuid,$2,$1::uuid::text,now())",[id,name]);
 for(const [id,uni]of[[student,campus],[owner,campus],[foreign,otherCampus]]){await pg.query("insert into users(id,email,password_hash,updated_at)values($1::uuid,$1::uuid::text||'@example.invalid','synthetic',now())",[id]);await pg.query("insert into profiles(id,user_id,university_id,username,display_name,biography,settings,updated_at)values(gen_random_uuid(),$1::uuid,$2,left($1::uuid::text,28),'Public student','A short public bio','{}',now())",[id,uni]);}
 for(const [id,user,uni,type]of[[vendor,owner,campus,"VENDOR"],[tutor,owner,campus,"TUTOR"],[foreignTutor,foreign,otherCampus,"TUTOR"]]){const application=crypto.randomUUID();await pg.query("insert into agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,$4,'Campus service','+2347000000000','Synthetic application for testing only')",[application,user,uni,type]);await pg.query("insert into agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,biography,verified_at)values($1,$2,$3,$4,$5,'Campus service','Public service biography',now())",[id,user,uni,application,type]);}
 await pg.query("insert into vendor_storefronts(vendor_profile_id,university_id,display_name,description,status,submitted_at,reviewed_by_user_id,reviewed_at,moderated_revision,contact_phone_e164,pickup_location)values($1,$2,'Test storefront','A real schema test store','APPROVED',now(),$3,now(),1,'+2348000000000','Campus gate pickup')",[vendor,campus,student]);
 const category=crypto.randomUUID();await pg.query("insert into product_categories(id,university_id,name,status)values($1,$2,'Books','APPROVED')",[category,campus]);await pg.query("insert into vendor_products(id,university_id,vendor_profile_id,name,description,category,category_id,price_kobo,stock_quantity,status)values($1,$2,$3,'Physics textbook','A useful physics textbook','Books',$4,100000,3,'PUBLISHED')",[product,campus,vendor,category]);
 for(const [id,uni]of[[tutor,campus],[foreignTutor,otherCampus]])await pg.query("insert into tutorial_listings(university_id,tutor_profile_id,course_code,title,description,format,price_kobo,capacity,status,review_status)values($1,$2,'MTH101','Math tutorial','An approved mathematics study session','IN_PERSON',100000,20,'PUBLISHED','APPROVED')",[uni,id]);
},60000);
afterAll(async()=>{await pg?.close();});
describe("public profiles and scoped campus tools",()=>{
 it("only exposes weighted saved CGPA after an explicit opt-in",async()=>{
  for(const [semester,units,points] of [[1,20,80],[2,10,30]]) await pg.query("insert into gpa_terms(university_id,user_id,session_label,semester,level_code,gpa,earned_units,quality_points) values($1,$2,'2025/2026',$3,'100',$4,$5,$6)",[campus,owner,semester,points/units,units,points]);
  expect((await result('/people/'+owner)).profile.cgpa).toBeNull();
  await pg.query(`update profiles set settings='{"hideCgpa":false}'::jsonb where user_id=$1`,[owner]);
  expect(Number((await result('/people/'+owner)).profile.cgpa)).toBe(3.67);
  await pg.query(`update profiles set settings='{"hideCgpa":true}'::jsonb where user_id=$1`,[owner]);
  expect((await result('/people/'+owner)).profile.cgpa).toBeNull();
 });
 it("exposes public details and counts but no private identity",async()=>{const r=await result('/people/'+owner);expect(r.profile).toMatchObject({user_id:owner,display_name:'Public student',biography:'A short public bio',follower_count:0,following_count:0,post_count:0});expect(r.roles).toHaveLength(2);for(const field of['email','password_hash','matric_number','phone','settings'])expect(r.profile).not.toHaveProperty(field);});
 it("follows idempotently and only modifies the current student's relationship",async()=>{for(let i=0;i<2;i++)expect(await result('/people/'+owner+'/follow','PUT',{follow:true})).toMatchObject({followed:true,follower_count:1});await result('/people/'+owner+'/follow','PUT',{follow:false,userId:foreign},student,400);expect((await result('/people/'+owner)).profile.followed).toBe(true);expect((await result('/people/'+student)).profile.following_count).toBe(1);await result('/people/'+student+'/follow','PUT',{follow:true},student,400);expect(await result('/people/'+owner+'/follow','PUT',{follow:false})).toMatchObject({follower_count:0});});
 it("hides personal role tags without concealing service ownership",async()=>{await pg.query(`update profiles set settings='{"publicRoles":{"vendor":false,"tutor":false}}'::jsonb where user_id=$1`,[owner]);expect((await result('/people/'+owner)).roles).toEqual([]);const store=await result('/people/services/'+vendor);expect(store.service).toMatchObject({user_id:owner,owner_name:'Public student',agent_type:'VENDOR'});expect(store.products.map((p:{id:string})=>p.id)).toEqual([product]);expect((await result('/people/products/'+product)).selectedProductId).toBe(product);expect((await result('/people/services/'+tutor)).tutorials).toHaveLength(1);});
 it("cannot read a different campus service and does not advertise it on a profile",async()=>{await result('/people/services/'+foreignTutor,'GET',undefined,student,404);expect((await result('/people/'+foreign)).roles).toEqual([]);});
 it("keeps business profiles readable before migration and while commerce is paused",async()=>{
  const owned=await result('/agents/public-profile/'+vendor,'GET',undefined,owner);
  expect(owned.editable).toBe(false);
  const r=await app.request('/people/services/'+vendor,{headers:{'x-user':student,'x-campus':campus}},{...env,STORE_ENABLED:'false'});
  expect(r.status).toBe(200); const data=await r.json();
  expect(data).toMatchObject({commerceAvailable:false,products:[],service:{display_name:'Test storefront',owner_name:'Public student'}});
  expect(data.service).not.toHaveProperty('following_count');
  expect(data.service.contact_phone_e164).toBeNull();
  await result('/agents/public-profile/'+vendor,'PUT',{},owner,503);
 });
 it("only lets the same-campus approved owner edit public fields and validates photo ownership",async()=>{
  await pg.exec(readFileSync(new URL('../../database/neon/migrations/20260930210000_public_business_profiles.sql',import.meta.url),'utf8'));
  const body={displayName:'Campus kitchen',biography:'Fresh food daily',categories:['Restaurant','Food','Food'],phone:'+2348012345678',whatsapp:'+2348012345678',pickupLocation:'North gate'};
  await result('/agents/public-profile/'+vendor,'PUT',body,student,404);
  await result('/agents/public-profile/'+foreignTutor,'PUT',body,owner,404);
  await result('/agents/public-profile/'+vendor,'PUT',{...body,verified:true},owner,400);
  const ownPhoto=crypto.randomUUID(),otherPhoto=crypto.randomUUID(),kycPhoto=crypto.randomUUID();
  for(const [mediaId,userId,kind]of[[ownPhoto,owner,'product'],[otherPhoto,student,'product'],[kycPhoto,owner,'kyc']])await pg.query("insert into media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name)values($1,$2,$3,$4,$1::uuid::text,'image/jpeg',200,'test.jpg')",[mediaId,userId,campus,kind]);
  for(const avatarMediaId of[otherPhoto,kycPhoto])await result('/agents/public-profile/'+vendor,'PUT',{...body,avatarMediaId},owner,400);
  expect(await result('/agents/public-profile/'+vendor,'PUT',{...body,avatarMediaId:ownPhoto},owner)).toMatchObject({saved:true,id:vendor});
  await result('/people/'+owner+'/follow','PUT',{follow:true});
  const publicProfile=await result('/people/services/'+vendor);
  expect(publicProfile.service).toMatchObject({display_name:'Campus kitchen',owner_name:'Public student',categories:['Restaurant','Food'],contact_phone_e164:body.phone,whatsapp_e164:body.whatsapp,follower_count:1,followed:true,product_count:1});
  expect(publicProfile.service.profile_image_url).toContain('/v1/media/'+ownPhoto);
  expect(JSON.stringify(publicProfile)).not.toContain('Synthetic application');
  expect((await pg.query('select profile_image_url from profiles where user_id=$1',[owner])).rows[0].profile_image_url).toBeNull();
  await result('/agents/public-profile/'+vendor,'PUT',{...body,biography:'',phone:null,whatsapp:null},owner);
  expect((await result('/people/services/'+vendor)).service).toMatchObject({biography:'',contact_phone_e164:null,whatsapp_e164:null});
  await result('/people/'+owner+'/follow','PUT',{follow:false});
 });
 it("shows only completed purchased-item reviews and their real rating aggregate",async()=>{
  await pg.exec('create unique index test_order_campus_unique on public.orders(id,university_id); create unique index test_product_campus_unique on public.vendor_products(id,university_id)');
  const commerce=readFileSync(new URL('../../database/neon/migrations/20260912200000_phase_3_commerce_foundation.sql',import.meta.url),'utf8');
  const reviewDDL=commerce.match(/create table if not exists public\.product_reviews \([\s\S]*?\n\);/); if(!reviewDDL)throw new Error('Missing review schema'); await pg.exec(reviewDDL[0]);
  for(const [status,rating,published,purchased]of[['DELIVERED',5,true,true],['DELIVERED',3,true,true],['PAID',1,true,true],['DELIVERED',1,false,true],['DELIVERED',1,true,false]] as const){
   const order=crypto.randomUUID();await pg.query('insert into orders(id,university_id,buyer_user_id,vendor_profile_id,status,subtotal_kobo)values($1,$2,$3,$4,$5,100000)',[order,campus,student,vendor,status]);
   if(purchased)await pg.query('insert into order_items(order_id,product_id,quantity,unit_price_kobo)values($1,$2,1,100000)',[order,product]);
   await pg.query('insert into product_reviews(university_id,order_id,product_id,buyer_user_id,rating,body,status)values($1,$2,$3,$4,$5,\'A useful review\',$6)',[campus,order,product,student,rating,published?'PUBLISHED':'HIDDEN_BY_MODERATION']);
  }
  const resultProfile=await result('/people/services/'+vendor);
  expect(resultProfile.service).toMatchObject({rating:4,review_count:2});
  expect(resultProfile.reviews).toHaveLength(2);
  expect(resultProfile.reviews.every((review:{verified_purchase:boolean})=>review.verified_purchase)).toBe(true);
 });
 it("queries actual published same-campus products, vendors and tutors",async()=>{const products=await runStudentTool(env,identity,'search_products',{query:'Physics'});expect(products.cards?.map(c=>c.id)).toEqual([product]);const vendors=await runStudentTool(env,identity,'search_vendors',{query:'Test'});expect(vendors.cards?.map(c=>c.id)).toEqual([vendor]);expect(vendors.cards?.[0]?.kind).toBe('vendor');const tutors=await runStudentTool(env,identity,'search_tutors',{query:'MTH101'});expect(tutors.cards).toHaveLength(1);expect(tutors.cards?.[0]?.path).toContain(tutor);await pg.query("update profiles set deleted_at=now() where user_id=$1",[owner]);expect((await runStudentTool(env,identity,'search_tutors',{query:'MTH101'})).cards).toEqual([]);await result('/people/services/'+vendor,'GET',undefined,student,404);await pg.query("update profiles set deleted_at=null where user_id=$1",[owner]);});
 it("rejects unknown admin tools and account-ID injection",async()=>{for(const name of['get_admin_url','execute_sql','delete_user'])expect((await runStudentTool(env,identity,name,{})).data).toHaveProperty('error');expect((await runStudentTool(env,identity,'get_my_timetable',{userId:owner})).data).toHaveProperty('error');expect((await runStudentTool(env,identity,'search_products',{query:'Physics',universityId:otherCampus})).data).toHaveProperty('error');});
 it("requires review before a standalone Kira alarm is saved and can undo it",async()=>{
  const firesAt=new Date(Date.now()+60*60*1000).toISOString();
  const prepared=await runStudentTool(env,identity,'prepare_alarm',{label:'Study thermodynamics',time:'18:30',days:[],firesAt,sound:'default',vibration:true,snoozeMinutes:5});
  expect(prepared.action?.type).toBe('alarm');
  expect((await pg.query('select id from student_alarms where id=$1',[prepared.action!.id])).rows).toHaveLength(0);
  const requestId=crypto.randomUUID(),action=prepared.action!;
  await pg.query("insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,status,result)values($1,$2,repeat('c',64),'study','COMPLETED',$3::jsonb)",[student,requestId,JSON.stringify({version:3,text:'Review this alarm',actions:[action]})]);
  expect(await result('/ai/actions/confirm','POST',{requestId,actionId:action.id})).toMatchObject({saved:true,id:action.id,type:'alarm'});
  const saved=(await pg.query<{id:string;timetable_entry_id:string|null}>('select id,timetable_entry_id from student_alarms where id=$1',[action.id])).rows;
  expect(saved).toHaveLength(1);expect(saved[0]?.timetable_entry_id).toBeNull();
  expect(await result('/ai/actions/undo','POST',{requestId,actionId:action.id})).toMatchObject({undone:true,id:action.id,type:'alarm'});
  expect((await pg.query('select id from student_alarms where id=$1',[action.id])).rows).toHaveLength(0);
 });
 it("requires review before a Kira calendar event is saved and can undo it",async()=>{
  const startsOn=new Date(Date.now()+2*86400000).toISOString().slice(0,10),endsOn=new Date(Date.now()+5*86400000).toISOString().slice(0,10);
  const prepared=await runStudentTool(env,identity,'prepare_calendar_event',{title:'Second semester exams',startsOn,endsOn,semester:'Second semester'});
  expect(prepared.action?.type).toBe('calendar');
  expect((await pg.query('select id from student_calendar_events where id=$1',[prepared.action!.id])).rows).toHaveLength(0);
  const requestId=crypto.randomUUID(),action=prepared.action!;
  await pg.query("insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,status,result)values($1,$2,repeat('d',64),'study','COMPLETED',$3::jsonb)",[student,requestId,JSON.stringify({version:3,text:'Review this calendar event',actions:[action]})]);
  expect(await result('/ai/actions/confirm','POST',{requestId,actionId:action.id})).toMatchObject({saved:true,id:action.id,type:'calendar'});
  expect((await pg.query('select title from student_calendar_events where id=$1 and user_id=$2',[action.id,student])).rows).toHaveLength(1);
  expect(await result('/ai/actions/undo','POST',{requestId,actionId:action.id})).toMatchObject({undone:true,id:action.id,type:'calendar'});
  expect((await pg.query('select id from student_calendar_events where id=$1',[action.id])).rows).toHaveLength(0);
 });
 it("validates dates, requires review, and confirms one class/alarm only",async()=>{
  const date=new Date(Date.now()+7*86400000).toISOString().slice(0,10),weekday=new Date(date+'T12:00Z').getUTCDay();
  const entry={title:'Mathematics 101',courseCode:'MTH101',dayOfWeek:weekday,startsAt:'10:00',endsAt:'11:30',date};
  expect(classDraftSchema.safeParse({...entry,date:'2027-02-30'}).success).toBe(false);expect(classDraftSchema.safeParse({...entry,endsAt:'09:00'}).success).toBe(false);
  const prepared=await runStudentTool(env,identity,'prepare_timetable_entry',entry);expect(prepared.action).toBeTruthy();expect((await pg.query('select id from timetable_entries')).rows).toHaveLength(0);
  const requestId=crypto.randomUUID(),action=prepared.action!;await pg.query("insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,status,result)values($1,$2,repeat('b',64),'study','COMPLETED',$3::jsonb)",[student,requestId,JSON.stringify({version:3,text:'Review this class',actions:[action]})]);
  await result('/ai/actions/confirm','POST',{requestId,actionId:action.id},owner,404);await result('/ai/actions/confirm','POST',{requestId,actionId:action.id,userId:owner},student,400);
  for(let i=0;i<2;i++)expect(await result('/ai/actions/confirm','POST',{requestId,actionId:action.id})).toMatchObject({saved:true,id:action.id});
  const classes=(await pg.query<{user_id:string;occurs_on:string}>('select user_id,occurs_on from timetable_entries')).rows;expect(classes).toHaveLength(1);expect(classes[0]?.user_id).toBe(student);const alarms=(await pg.query<{days:unknown[];fires_at:string}>('select days,fires_at from student_alarms where timetable_entry_id=$1',[action.id])).rows;expect(alarms).toHaveLength(1);expect(alarms[0]?.days).toEqual([]);expect(alarms[0]?.fires_at).toBeTruthy();
  const own=await runStudentTool(env,identity,'get_my_timetable',{});expect(JSON.stringify(own.data)).toContain('90');expect(JSON.stringify((await runStudentTool(env,{...identity,id:owner},'get_my_timetable',{})).data)).not.toContain('Mathematics 101');
 });
});
