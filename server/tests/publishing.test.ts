import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, testDatabaseAdapter } from "./helpers/database";
import { publishingRoutes } from "../src/routes/publishing";
import { AppError } from "../src/lib/errors";
import type { Bindings, Variables } from "../src/types";
let db: PGlite;
const publisher="12000000-0000-4000-8000-000000000001", student="12000000-0000-4000-8000-000000000002", outsider="12000000-0000-4000-8000-000000000003",school="12000000-0000-4000-8000-000000000010",otherSchool="12000000-0000-4000-8000-000000000011";
vi.mock("../src/lib/database",()=>({database:()=>testDatabaseAdapter(db),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
vi.mock("../src/middleware/auth",()=>({requireAuth:async(c:any,next:()=>Promise<void>)=>{const actor=c.req.header("X-Test-User");c.set("user",{id:actor,universityId:actor===outsider?otherSchool:school,roles:["STUDENT"]});await next();},currentUser:(c:any)=>c.get("user")}));
const app=new Hono<{Bindings:Bindings;Variables:Variables}>();app.route("/",publishingRoutes);
app.onError((e,c)=>e instanceof AppError?c.json({error:e.message},e.status):c.json({error:e.message},500));
function request(path:string,method="GET",body?:unknown,actor=publisher){return app.request("https://example.invalid/publishing"+path,{method,headers:{"X-Test-User":actor,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})},{UNIFIED_SCHEMA_READY:"true"} as Bindings);}
async function data(response:Response,status=200){const value=await response.json();expect({status:response.status,...(response.status===status?{}:{value})}).toEqual({status});return value as any;}
async function grant(actor=publisher,format="ANONYMOUS_QA"){await db.query("insert into app_private.publishing_capabilities(user_id,institution_id,capability,granted_by,reason) values($1,$2,$3,$1,'test grant') on conflict do nothing",[actor,school,format]);}
async function create(format="ANONYMOUS_QA"){await grant(publisher,format);return data(await request("/posts","POST",{requestId:crypto.randomUUID(),format,body:"What should improve on campus?",...(format==="POLL"?{options:["Library","Transport"]}:{})}),201);}
beforeAll(async()=>{db=await createTestDatabase();for(const [i,id] of [school,otherSchool].entries())await db.query("insert into public.universities(id,name,slug,updated_at) values($1,$2,$3,now())",[id,"School "+i,"publishing-school-"+i]);for(const [i,id] of [publisher,student,outsider].entries()){await db.query("insert into public.users(id,email,password_hash,updated_at) values($1,$2,'test-only',now())",[id,`publishing${i}@example.invalid`]);await db.query("insert into public.profiles(id,user_id,username,display_name,university_id,updated_at) values(gen_random_uuid(),$1,$2,$3,$4,now())",[id,"publishing"+i,i===1?"Private Student Name":"Test Publisher",i===2?otherSchool:school]);}},60000);
beforeEach(async()=>{await db.exec("truncate app_private.publishing_answer_owners,public.publishing_answers,app_private.poll_votes,public.poll_options,public.publishing_posts,public.feed_posts,app_private.publishing_capabilities cascade");});
afterAll(async()=>{await db?.close();});

describe("IDs79–86: capability-based publishing and private answers",()=>{
 it("requires an explicit institution-specific capability and deduplicates creation",async()=>{
  expect((await data(await request("/capabilities"))).formats).toEqual([]);
  const body={requestId:crypto.randomUUID(),format:"POLL",body:"Choose a campus improvement",options:["Library","Transport"]};
  await data(await request("/posts","POST",body),403);await grant(publisher,"POLL");
  const posts=await Promise.all([request("/posts","POST",body),request("/posts","POST",body)]);
  expect(posts.map(p=>p.status).sort()).toEqual([200,201]);
  expect((await db.query("select * from public.publishing_posts")).rows).toHaveLength(1);
  await data(await request("/posts","POST",{...body,body:"Changed question"}),409);
  expect((await data(await request("/capabilities"))).formats).toEqual(["POLL"]);
 });
 it("keeps anonymous authors private in inboxes and public answers; isolates universities",async()=>{
  const post=await create();const answer=await data(await request(`/posts/${post.id}/answers`,"POST",{requestId:crypto.randomUUID(),body:"Extend opening hours",acceptPublication:true},student),201);
  const before=await data(await request(`/posts/${post.id}`,"GET",undefined,student));expect(before.answers).toEqual([]);
  const inbox=await data(await request(`/posts/${post.id}/inbox`));expect(inbox.answers).toHaveLength(1);
  expect(inbox.answers[0].author_name).toBeNull();expect(JSON.stringify(inbox)).not.toContain(student);expect(JSON.stringify(inbox)).not.toContain("Private Student Name");
  await data(await request(`/posts/${post.id}/inbox`,"GET",undefined,student),403);
  await data(await request(`/posts/${post.id}`,"GET",undefined,outsider),404);
  await data(await request(`/posts/${post.id}/answers`,"POST",{requestId:crypto.randomUUID(),body:"Other school",acceptPublication:true},outsider),404);
  await data(await request(`/posts/${post.id}/answers/${answer.id}/publish`,"POST",{reply:"Thanks"},student),403);
  await data(await request(`/posts/${post.id}/answers/${answer.id}/publish`,"POST",{reply:"We will raise this with the library team."}));
  const published=await data(await request(`/posts/${post.id}`));expect(published.answers[0]).toMatchObject({id:answer.id,author_name:null,status:"PUBLISHED"});expect(JSON.stringify(published)).not.toContain(student);expect(JSON.stringify(published)).not.toContain("Private Student Name");
 });
 it("requires disclosure consent and replays an answer once without changing content",async()=>{
  const post=await create("QA");const body={requestId:crypto.randomUUID(),body:"Library opening hours",acceptPublication:true};
  await data(await request(`/posts/${post.id}/answers`,"POST",{...body,acceptPublication:false},student),400);
  const first=await data(await request(`/posts/${post.id}/answers`,"POST",body,student),201);
  const repeated=await data(await request(`/posts/${post.id}/answers`,"POST",body,student));expect(repeated.id).toBe(first.id);
  await data(await request(`/posts/${post.id}/answers`,"POST",{...body,body:"Changed"},student),409);
  expect((await data(await request(`/posts/${post.id}/inbox`))).answers[0].author_name).toBe("Private Student Name");
  expect((await data(await request(`/posts/${post.id}`,"GET",undefined,student))).answers).toEqual([]);
 });
 it("counts one vote per account under concurrent requests without revealing voter identities",async()=>{
  const post=await create("POLL");const responses=await Promise.all([request(`/posts/${post.id}/vote`,"POST",{optionId:1},student),request(`/posts/${post.id}/vote`,"POST",{optionId:2},student)]);
  expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
  const view=await data(await request(`/posts/${post.id}`,"GET",undefined,student));expect(view.options.reduce((sum:number,o:any)=>sum+o.votes,0)).toBe(1);expect([1,2]).toContain(view.myVote);expect(JSON.stringify(view)).not.toContain(student);
  await data(await request(`/posts/${post.id}/vote`,"POST",{optionId:1},outsider),404);
  await db.query("update public.publishing_posts set closes_at=now()-interval '1 minute' where post_id=$1",[post.id]);
  await data(await request(`/posts/${post.id}/vote`,"POST",{optionId:1}),409);
 });
 it("lets answer authors retract shared content and prevents republishing deleted answers",async()=>{
  const post=await create();const answer=await data(await request(`/posts/${post.id}/answers`,"POST",{requestId:crypto.randomUUID(),body:"Private response",acceptPublication:true},student),201);
  await data(await request(`/posts/${post.id}/answers/${answer.id}/publish`,"POST",{reply:"Publisher reply"}));
  await data(await request(`/posts/${post.id}/answers/${answer.id}`,"DELETE",undefined,outsider),404);
  await data(await request(`/posts/${post.id}/answers/${answer.id}`,"DELETE",undefined,student));
  expect((await data(await request(`/posts/${post.id}`))).answers).toEqual([]);expect((await data(await request(`/posts/${post.id}/inbox`))).answers).toEqual([]);
  await data(await request(`/posts/${post.id}/answers/${answer.id}/publish`,"POST",{reply:"Restore"}),404);
 });
});
