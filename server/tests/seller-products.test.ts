import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {Hono,type Context,type Next} from 'hono';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,testDatabaseAdapter,testSqlClient} from './helpers/database';
import {agentRoutes} from '../src/routes/agents';
import {AppError} from '../src/lib/errors';
import type {Bindings} from '../src/types';
let pg:PGlite;
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(pg),sqlClient:()=>testSqlClient(pg),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
vi.mock('../src/middleware/auth',()=>({currentUser:(c:Context)=>({id:c.req.header('x-user'),universityId:c.req.header('x-campus'),roles:['STUDENT']}),requireAuth:async(c:Context,n:Next)=>c.req.header('x-user')?n():c.json({error:'Unauthorized'},401)}));
const campus=crypto.randomUUID(),otherCampus=crypto.randomUUID(),owner=crypto.randomUUID(),other=crypto.randomUUID(),vendor=crypto.randomUUID(),otherVendor=crypto.randomUUID(),category=crypto.randomUUID(),otherCategory=crypto.randomUUID();
const env={PHASE_3_SCHEMA_READY:'true',STORE_ENABLED:'true'} as Bindings;
const app=new Hono().route('/agents',agentRoutes);
app.onError((error,c)=>c.json({error:error.message},error instanceof AppError?error.status:500));
async function request(path:string,method='GET',body?:unknown,user=owner,uni=campus){
 const r=await app.request('/agents'+path,{method,headers:{'x-user':user,'x-campus':uni,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},env);
 return{status:r.status,body:await r.json() as any};
}
const photo='https://fixture.invalid/cover.jpg';
const details=(extra:Record<string,unknown>={})=>({name:'Notebook',description:'An unused campus notebook.',categoryId:category,priceKobo:100000,imageUrl:photo,imageUrls:[photo],preparationMinutes:90,packageWeightGrams:500,packageLengthCm:20,packageWidthCm:15,packageHeightCm:2,bicycleDeliveryEligible:true,...extra});
async function create(){const r=await request('/products','POST',{...details(),stockQuantity:3,requestId:crypto.randomUUID()});expect(r.status,JSON.stringify(r.body)).toBe(201);return r.body.id as string;}
async function row(id:string){return(await pg.query<any>('select * from public.vendor_products where id=$1',[id])).rows[0];}
beforeAll(async()=>{
 pg=await createTestDatabase();
 for(const name of ['20260912200000_phase_3_commerce_foundation.sql','20260930220000_store_fulfilment_modes.sql','20261006101000_verified_vendor_publication.sql'])await pg.exec(readFileSync(new URL('../../database/neon/migrations/'+name,import.meta.url),'utf8'));
 for(const id of [campus,otherCampus])await pg.query("insert into universities(id,name,slug,updated_at)values($1,'Synthetic campus '||$1::uuid::text,$1::uuid::text,now())",[id]);
 for(const [user,uni,profile,cat]of [[owner,campus,vendor,category],[other,otherCampus,otherVendor,otherCategory]]){
  await pg.query("insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','synthetic',now())",[user]);
  await pg.query("insert into profiles(id,user_id,university_id,username,display_name,updated_at)values($1,$1,$2,'fixture_'||substring(replace($1::uuid::text,'-',''),1,20),'Synthetic seller',now())",[user,uni]);
  const application=crypto.randomUUID();
  await pg.query("insert into agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,'VENDOR','Synthetic shop','+2348000000000','Synthetic fixture only')",[application,user,uni]);
  await pg.query("insert into agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at)values($1,$2,$3,$4,'VENDOR','Synthetic shop',now())",[profile,user,uni,application]);
  await pg.query("insert into product_categories(id,university_id,name,status,reviewed_at)values($1,$2,'Books','APPROVED',now())",[cat,uni]);
 }
},60000);
afterAll(async()=>{await pg?.close();});
describe('owner product editing, photos and removal',()=>{
 it('returns all product photos and atomically edits the gallery, cover, price and stock',async()=>{
  const id=await create(),before=await row(id),second='https://fixture.invalid/second.jpg';
  expect((await request('/products')).body.products.find((p:any)=>p.id===id).image_urls).toEqual([photo]);
  const result=await request('/products/'+id,'PUT',details({name:'New notebook',priceKobo:125000,imageUrls:[second,photo],imageUrl:second,stockQuantity:5,expectedStockQuantity:3,expectedRevision:before.listing_revision}));
  expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(await row(id)).toMatchObject({name:'New notebook',price_kobo:125000,stock_quantity:5,image_url:second,image_urls:[second,photo],status:'PUBLISHED',preparation_minutes:90,bicycle_delivery_eligible:true,listing_revision:before.listing_revision+1});
  expect((await pg.query('select * from app_private.audit_events where target_id=$1 and action=$2',[id,'product.saved'])).rows).toHaveLength(1);
 });
 it('rejects stale edits and inventory overwrites while preserving sold stock in a details-only edit',async()=>{
  const id=await create(),before=await row(id);
  await pg.query('update public.vendor_products set stock_quantity=2 where id=$1',[id]);
  expect((await request('/products/'+id,'PUT',details({stockQuantity:8,expectedStockQuantity:3,expectedRevision:before.listing_revision}))).status).toBe(409);
  expect((await request('/products/'+id,'PUT',details({name:'Updated notebook',expectedRevision:before.listing_revision}))).status).toBe(200);
  expect((await row(id)).stock_quantity).toBe(2);
  expect((await request('/products/'+id,'PUT',details({name:'Stale notebook',expectedRevision:before.listing_revision}))).status).toBe(409);
  expect((await row(id)).name).toBe('Updated notebook');
 });
 it('rejects foreign ownership and foreign campus categories without exposing or changing the product',async()=>{
  const id=await create();
  expect((await request('/products/'+id,'PUT',details({categoryId:otherCategory}),other,otherCampus)).status).toBe(409);
  expect((await request('/products/'+id+'/status','PATCH',{status:'ARCHIVED'},other,otherCampus)).status).toBe(409);
  expect((await request('/products','GET',undefined,other,otherCampus)).body.products).toEqual([]);
  expect((await request('/products/'+id,'PUT',details({categoryId:otherCategory}))).status).toBe(400);
  expect((await row(id)).status).toBe('PUBLISHED');
 });
 it('preserves legacy galleries when an old edit does not supply gallery fields',async()=>{
  const id=await create();
  const body=details({name:'Legacy edit'});delete (body as any).imageUrls;delete (body as any).imageUrl;
  expect((await request('/products/'+id,'PUT',body)).status).toBe(200);
  expect(await row(id)).toMatchObject({image_url:photo,image_urls:[photo]});
 });
 it('rejects inconsistent covers, oversized galleries and unguarded stock changes',async()=>{
  const id=await create();
  for(const change of [{imageUrl:'https://fixture.invalid/different.jpg'},{imageUrls:Array.from({length:7},(_,n)=>`https://fixture.invalid/${n}.jpg`)},{stockQuantity:5}])expect((await request('/products/'+id,'PUT',details(change))).status).toBe(400);
  expect((await row(id)).stock_quantity).toBe(3);
 });
 it('removes a product from the seller list while keeping existing purchased item records',async()=>{
  const id=await create(),order=crypto.randomUUID();
  await pg.query("insert into orders(id,university_id,buyer_user_id,vendor_profile_id,status,subtotal_kobo)values($1,$2,$3,$4,'PAID',100000)",[order,campus,owner,vendor]);
  await pg.query('insert into order_items(order_id,product_id,quantity,unit_price_kobo)values($1,$2,1,100000)',[order,id]);
  expect((await request('/products/'+id+'/status','PATCH',{status:'ARCHIVED'})).status).toBe(200);
  expect((await request('/products')).body.products.some((p:any)=>p.id===id)).toBe(false);
  expect((await row(id)).status).toBe('ARCHIVED');
  expect((await pg.query('select quantity,unit_price_kobo from order_items where order_id=$1',[order])).rows).toEqual([{quantity:1,unit_price_kobo:100000}]);
  expect((await request('/products/'+id,'PUT',details())).status).toBe(409);
 });
 it('rolls back the product update when its audit write fails',async()=>{
  const id=await create();
  await pg.exec("create function app_private.fail_product_edit_audit() returns trigger language plpgsql as $$begin if new.action in('product.saved','product.archived') then raise exception 'SYNTHETIC_AUDIT_FAILURE';end if;return new;end$$;create trigger fail_product_edit_audit before insert on app_private.audit_events for each row execute function app_private.fail_product_edit_audit();");
  try{expect((await request('/products/'+id,'PUT',details({name:'Should roll back'}))).status).toBe(500);expect((await row(id)).name).toBe('Notebook');expect((await request('/products/'+id+'/status','PATCH',{status:'ARCHIVED'})).status).toBe(500);expect((await row(id)).status).toBe('PUBLISHED');}
  finally{await pg.exec('drop trigger fail_product_edit_audit on app_private.audit_events;drop function app_private.fail_product_edit_audit();');}
 });
 it('blocks mutations for suspended stores and rejects malformed product IDs',async()=>{
  const id=await create();
  expect((await request('/products/not-an-id','PUT',details())).status).toBe(400);
  expect((await request('/products/not-an-id/status','PATCH',{status:'ARCHIVED'})).status).toBe(400);
  await pg.query("update public.vendor_storefronts set status='SUSPENDED' where vendor_profile_id=$1",[vendor]);
  try{expect((await request('/products/'+id,'PUT',details())).status).toBe(403);expect((await request('/products/'+id+'/status','PATCH',{status:'ARCHIVED'})).status).toBe(403);}
  finally{await pg.query("update public.vendor_storefronts set status='APPROVED' where vendor_profile_id=$1",[vendor]);}
 });
});
