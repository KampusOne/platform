import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { Hono, type Context, type Next } from 'hono';
import type { PGlite } from '@electric-sql/pglite';
import { october6Database } from './helpers/oct6-database';
import { testDatabaseAdapter } from './helpers/database';
import { studentRoutes } from '../src/routes/student';
import { AppError } from '../src/lib/errors';
import type { Bindings } from '../src/types';
let pg: PGlite;
vi.mock('../src/lib/database', () => ({ database: () => testDatabaseAdapter(pg), firstRow: (result: {rows:unknown[]}) => result.rows[0] }));
vi.mock('../src/middleware/auth', () => ({ currentUser: (c:Context) => ({ id:c.req.header('x-user'), universityId:c.req.header('x-campus'), roles:['STUDENT'] }), requireAuth: (_c:Context,next:Next) => next() }));
vi.mock('../src/lib/delivery-routing', () => ({ riderPickupAvailability: async () => new Map() }));
const campus=crypto.randomUUID(), foreign=crypto.randomUUID(), owner=crypto.randomUUID(), buyer=crypto.randomUUID(), vendor=crypto.randomUUID(), tutor=crypto.randomUUID(), category=crypto.randomUUID();
const products=Array.from({length:225},()=>crypto.randomUUID()), materials=Array.from({length:155},()=>crypto.randomUUID());
const env={ STORE_ENABLED:'true', TUTORIALS_ENABLED:'true', PHASE_2_SCHEMA_READY:'true', PHASE_3_SCHEMA_READY:'true', UNIFIED_SCHEMA_READY:'true' } as Bindings;
const app=new Hono().route('/student',studentRoutes);
app.onError((e,c)=>c.json({error:e.message},e instanceof AppError?e.status:500));
async function get(path:string,school=campus,user=buyer,expected=200){const response=await app.request('/student/'+path,{headers:{'x-user':user,'x-campus':school}},env);const result=await response.json();expect(response.status,JSON.stringify(result)).toBe(expected);return result;}
beforeAll(async()=>{
 pg=await october6Database();
 for(const file of ['20261015110000_exclusive_agent_roles.sql','20261017120000_campus_release.sql']) await pg.exec(readFileSync(new URL('../../database/neon/migrations/'+file,import.meta.url),'utf8'));
 for(const id of [campus,foreign])await pg.query("insert into universities(id,name,slug,updated_at)values($1,'Paging fixture '||$1::uuid::text,$1::uuid::text,now())",[id]);
 for(const id of [owner,buyer])await pg.query("insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','synthetic',now())",[id]);
 for(const [id,role]of [[vendor,'VENDOR'],[tutor,'TUTOR']]){
  const application=crypto.randomUUID();await pg.query("insert into agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,$4,'Ada paging','+2348012345678','Synthetic pagination fixture for local tests only')",[application,owner,campus,role]);
  await pg.query("insert into agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at)values($1,$2,$3,$4,$5,'Ada paging',now())",[id,owner,campus,application,role]);
 }
 await pg.query("update vendor_storefronts set display_name='Ada campus shop',description='Synthetic shop description for local tests only',status='APPROVED',contact_phone_e164='+2348012345678',pickup_location='Campus counter',opening_hours='{}' where vendor_profile_id=$1",[vendor]);
 await pg.query("insert into product_categories(id,university_id,name,status)values($1,$2,'Books','APPROVED')",[category,campus]);
 for(const [n,id]of products.entries())await pg.query("insert into vendor_products(id,university_id,vendor_profile_id,name,description,image_url,category,category_id,price_kobo,stock_quantity,status,moderated_revision,reviewed_at,reviewed_by_user_id,updated_at)values($1,$2,$3,$4,'Synthetic product','https://example.invalid/product.jpg','Books',$5,100000,5,'PUBLISHED',1,now(),$7,'2026-10-01'::timestamptz + ($6||' seconds')::interval)",[id,campus,vendor,`Book ${n+1}`,category,n,owner]);
 for(const [n,id]of materials.entries())await pg.query("insert into tutorial_resources(id,university_id,tutor_profile_id,course_code,title,description,resource_type,access_model,price_kobo,publisher_name,status,subject,created_at)values($1,$2,$3,'GET205',$4,'Synthetic local study material description','PDF','FREE',0,'Ada paging','PUBLISHED',$5,'2026-10-01'::timestamptz + ($6||' seconds')::interval)",[id,campus,tutor,`Material ${n+1}`,n%2?'Engineering':'Physics',n]);
 for(let n=0;n<8;n++){
  const id=crypto.randomUUID();await pg.query("insert into tutorial_listings(id,university_id,tutor_profile_id,course_code,title,description,format,price_kobo,capacity,status,review_status)values($1,$2,$3,'GET205','Fluid mechanics session','Synthetic tutorial session for local tests only','IN_PERSON',0,5,'PUBLISHED','APPROVED')",[id,campus,tutor]);
  await pg.query("insert into tutorial_availability_windows(id,listing_id,starts_at,ends_at,capacity)values($1,$2,now()+interval '1 day',now()+interval '25 hours',5)",[crypto.randomUUID(),id]);
 }
},60000);
afterAll(async()=>pg?.close());
it('returns 24 stable products per page, including products beyond the former 200 row cap',async()=>{
 const seen:string[]=[];
 for(let page=1;page<=10;page++){const data=await get('store?page='+page);expect(data.pagination).toEqual({page,pageSize:24,total:225,totalPages:10});expect(data.products).toHaveLength(page===10?9:24);seen.push(...data.products.map((p:{id:string})=>p.id));}
 expect(seen).toEqual([...products].reverse());expect(new Set(seen).size).toBe(225);
});
it('keeps off-page cart products visible independently of search while applying the same access policy',async()=>{
 const data=await get(`store?page=1&q=Book%20225&includeIds=${products[0]},${products[224]}`);
 expect(data.products.map((p:{id:string})=>p.id)).toEqual([products[224]]);expect(data.pagination.total).toBe(1);expect(data.includedProducts).toHaveLength(2);expect(data.categories).toEqual(['Books']);
 const other=await get(`store?page=1&includeIds=${products[0]}`,foreign);expect(other.products).toEqual([]);expect(other.includedProducts).toEqual([]);expect(other.pagination.total).toBe(0);
 await get('store?page=0',campus,buyer,400);await get('store?page=1&includeIds=bad',campus,buyer,400);
});
it('shares a 30-item learning budget across resources and sessions and reaches materials after the old limit',async()=>{
 const page1=await get('tutorials?page=1');expect(page1.resources).toHaveLength(30);expect(page1.listings).toHaveLength(0);expect(page1.pagination).toEqual({page:1,pageSize:30,total:163,totalPages:6});expect(page1.subjects).toEqual(['Engineering','Physics']);
 const last=await get('tutorials?page=6');expect(last.resources).toHaveLength(5);expect(last.listings).toHaveLength(8);expect(last.resources.map((r:{id:string})=>r.id)).toEqual(materials.slice(0,5).reverse());
 const all:string[]=[];for(let page=1;page<=6;page++){const data=await get('tutorials?page='+page);expect(data.resources.length+data.listings.length).toBeLessThanOrEqual(30);all.push(...data.resources.map((r:{id:string})=>r.id));}expect(new Set(all).size).toBe(155);
 const videos=await get('tutorials?page=1&category=Videos&resourceType=VIDEO');expect(videos.resources).toEqual([]);expect(videos.listings).toEqual([]);
 const match=await get('tutorials?page=1&q=Material%20155');expect(match.resources.map((r:{id:string})=>r.id)).toEqual([materials[154]]);expect(match.pagination.total).toBe(1);
 const tutors=await get('tutorials?page=1&category=Tutors');expect(tutors.resources).toEqual([]);expect(tutors.listings).toHaveLength(8);
});
it('scopes counts, facets, cart lookups and tutor pages to campus and mutual blocks',async()=>{
 expect((await get('tutorials?page=1',foreign)).pagination.total).toBe(0);
 const directory=await get('tutors?page=1');expect(directory.tutors).toHaveLength(1);expect(directory.tutors[0].verified).toBe(true);expect(directory.pagination.total).toBe(1);
 await pg.query('insert into user_blocks(blocker_id,blocked_id)values($1,$2)',[owner,buyer]);
 const store=await get(`store?page=1&includeIds=${products[0]}`);expect(store.products).toEqual([]);expect(store.includedProducts).toEqual([]);expect(store.categories).toEqual([]);expect(store.pagination.total).toBe(0);
 expect((await get('tutorials?page=1')).pagination.total).toBe(0);expect((await get('tutors?page=1')).pagination.total).toBe(0);
});
