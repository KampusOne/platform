import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono, type Context, type Next } from 'hono';
import type { PGlite } from '@electric-sql/pglite';
import { october6Database } from './helpers/oct6-database';
import { testDatabaseAdapter } from './helpers/database';
import { studentRoutes } from '../src/routes/student';
import { mappedDeliveryPoint, campusDeliveryRoute, riderPickupAvailability } from '../src/lib/delivery-routing';
import { AppError } from '../src/lib/errors';
import type { Bindings } from '../src/types';

let pg: PGlite;
vi.mock('../src/lib/database', () => ({ database: () => testDatabaseAdapter(pg), firstRow: (r: { rows: unknown[] }) => r.rows[0] }));
vi.mock('../src/middleware/auth', () => ({ currentUser: (c: Context) => ({ id: c.req.header('x-user'), universityId: c.req.header('x-campus'), roles: ['STUDENT'] }), requireAuth: async (_c: Context, next: Next) => next() }));
const uni=crypto.randomUUID(), foreignUni=crypto.randomUUID(), campus=crypto.randomUUID(), otherCampus=crypto.randomUUID(), hiddenCampus=crypto.randomUUID(), foreignCampus=crypto.randomUUID(), student=crypto.randomUUID();
const landmark=crypto.randomUUID(), entrancePlace=crypto.randomUUID(), addressOnly=crypto.randomUUID();
const vendors=[{id:crypto.randomUUID(),user:crypto.randomUUID()},{id:crypto.randomUUID(),user:crypto.randomUUID()}];
const env={UNIFIED_SCHEMA_READY:'true',STORE_ENABLED:'true',PAYMENTS_ENABLED:'true',LOGISTICS_ENABLED:'true'} as Bindings;
const app=new Hono().route('/student',studentRoutes);
app.onError((e,c)=>c.json({error:e.message},e instanceof AppError?e.status:500));
async function directory(cursor?:string,institution=uni){const response=await app.request('/student/delivery-places'+(cursor?'?cursor='+cursor:''),{headers:{'x-user':student,'x-campus':institution}},env);const body=await response.json() as any;expect(response.status,JSON.stringify(body)).toBe(200);return body;}
beforeAll(async()=>{
 pg=await october6Database();
 for(const id of [uni,foreignUni])await pg.query("insert into universities(id,name,slug,updated_at)values($1,'Synthetic university '||$1::uuid::text,$1::uuid::text,now())",[id]);
 for(const user of [student,...vendors.map(v=>v.user)]){
  await pg.query("insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','synthetic',now())",[user]);
  await pg.query("insert into profiles(id,user_id,university_id,username,display_name,updated_at)values($1,$1,$2,left($1::uuid::text,28),'Synthetic student',now())",[user,uni]);
 }
 for(const [id,institution,name,status] of [[campus,uni,'Ugbowo campus','PUBLISHED'],[otherCampus,uni,'Ekehuan campus','PUBLISHED'],[hiddenCampus,uni,'Draft campus','DRAFT'],[foreignCampus,foreignUni,'Foreign campus','PUBLISHED']])await pg.query('insert into institution_campuses(id,institution_id,name,slug,status)values($1,$2,$3,$1::uuid::text,$4)',[id,institution,name,status]);
 await pg.query("insert into campus_places(university_id,campus_id,name,category,status,latitude,longitude,source_provider,confidence)select $1,$2,'Campus place '||n,'ACADEMIC','PUBLISHED',6.4,5.62,'KAMPUSONE',.5 from generate_series(1,205)n",[uni,campus]);
 await pg.query("insert into campus_places(id,university_id,campus_id,name,category,status,latitude,longitude,source_provider,confidence,search_aliases)values($1,$2,$3,'Hall Four','HOSTEL','PUBLISHED',6.4,5.62,'KAMPUSONE',.5,ARRAY['Hall 4','Student hostel'])",[landmark,uni,otherCampus]);
 await pg.query("insert into campus_places(id,university_id,campus_id,name,category,status,latitude,longitude,source_provider,confidence)values($1,$2,$3,'Reviewed Overture building','ACADEMIC','PUBLISHED',6.4,5.62,'OVERTURE',.8)",[entrancePlace,uni,campus]);
 await pg.query("insert into campus_places(id,university_id,name,category,status)values($1,$2,'Address without a pin','SERVICE','PUBLISHED')",[addressOnly,uni]);
 for(const [institution,campusId,name,status]of[[uni,campus,'Draft place','DRAFT'],[uni,hiddenCampus,'Hidden campus place','PUBLISHED'],[foreignUni,foreignCampus,'Foreign place','PUBLISHED']])await pg.query('insert into campus_places(university_id,campus_id,name,category,status)values($1,$2,$3,$4,$5)',[institution,campusId,name,'ACADEMIC',status]);
 for(const [n,vendor]of vendors.entries()){
  const application=crypto.randomUUID();
  await pg.query("insert into agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,'VENDOR','Fixture vendor','+2348000000000','Synthetic fixture only')",[application,vendor.user,uni]);
  await pg.query("insert into agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,status,verified_at)values($1,$2,$3,$4,'VENDOR','Fixture vendor','ACTIVE',now())",[vendor.id,vendor.user,uni,application]);
  await pg.query("insert into vendor_storefronts(vendor_profile_id,university_id,display_name,description,status,submitted_at,reviewed_by_user_id,reviewed_at,moderated_revision,contact_phone_e164,pickup_location,pickup_place_id)values($1,$2,'Fixture store','A synthetic store fixture','APPROVED',now(),$3,now(),1,'+2348000000000','Library entrance',$4) on conflict(vendor_profile_id) do update set pickup_place_id=excluded.pickup_place_id,pickup_location=excluded.pickup_location",[vendor.id,uni,student,n===0?landmark:null]);
  await pg.query("update vendor_storefronts set status='APPROVED',submitted_at=now(),reviewed_by_user_id=$2,reviewed_at=now(),moderated_revision=listing_revision where vendor_profile_id=$1",[vendor.id,student]);
 }
},60000);
afterAll(async()=>{await pg?.close();});
describe('checkout campus directory and seller pickup readiness',()=>{
 it('returns every published directory place across both campuses without the OSM-only or 20-place cutoff',async()=>{
  const first=await directory();expect(first.places).toHaveLength(200);expect(first.nextCursor).toEqual(expect.any(String));
  const second=await directory(first.nextCursor);expect(second.nextCursor).toBeNull();
  const places=[...first.places,...second.places];expect(places).toHaveLength(208);expect(new Set(places.map(p=>p.id)).size).toBe(208);
  expect(places.find(p=>p.id===landmark)).toMatchObject({campus_name:'Ekehuan campus',search_aliases:['Hall 4','Student hostel'],has_map_point:true});
  expect(places.find(p=>p.id===entrancePlace)?.has_map_point).toBe(true);expect(places.find(p=>p.id===addressOnly)?.has_map_point).toBe(false);
  for(const name of ['Draft place','Hidden campus place','Foreign place'])expect(places.some(p=>p.name===name)).toBe(false);
 });
 it('keeps campus scope and validates directory cursors',async()=>{
  expect((await directory(undefined,foreignUni)).places.map((p:any)=>p.name)).toEqual(['Foreign place']);
  expect((await app.request('/student/delivery-places?cursor=bad',{headers:{'x-user':student,'x-campus':uni}},env)).status).toBe(400);
  await expect(mappedDeliveryPoint(env,foreignUni,landmark)).rejects.toMatchObject({status:422});
 });
 it('uses published landmark coordinates while preferring verified entrances and never invents a missing point or road route',async()=>{
  expect(await mappedDeliveryPoint(env,uni,landmark)).toMatchObject({campus_id:otherCampus,latitude:6.4,longitude:5.62,entrance_verified:false});
  await pg.query("insert into campus_entrances(institution_id,campus_id,place_id,geom,label,preferred,verified_at)values($1,$2,$3,ST_SetSRID(ST_MakePoint(5.6202,6.4002),4326),'Fixture entrance',true,now())",[uni,campus,entrancePlace]);
  expect(await mappedDeliveryPoint(env,uni,entrancePlace)).toMatchObject({latitude:6.4002,longitude:5.6202,entrance_verified:true});
  await expect(mappedDeliveryPoint(env,uni,addressOnly)).rejects.toMatchObject({status:422});
  await expect(campusDeliveryRoute(env,uni,campus,[5.62,6.4],[5.6202,6.4002])).rejects.toMatchObject({status:422});
 });
 it('offers rider delivery only for a mapped pickup or a recent accurate seller position',async()=>{
  let ready=await riderPickupAvailability(env,uni,vendors.map(v=>v.id));expect(ready.get(vendors[0]!.id)).toBe(true);expect(ready.get(vendors[1]!.id)).toBe(false);
  await pg.query('insert into app_private.agent_route_positions(agent_profile_id,institution_id,latitude,longitude,accuracy_metres,captured_at)values($1,$2,6.4,5.62,10,now())',[vendors[1]!.id,uni]);
  ready=await riderPickupAvailability(env,uni,vendors.map(v=>v.id));expect(ready.get(vendors[1]!.id)).toBe(true);
  await pg.query("update app_private.agent_route_positions set captured_at=now()-interval '3 minutes' where agent_profile_id=$1",[vendors[1]!.id]);
  expect((await riderPickupAvailability(env,uni,vendors.map(v=>v.id))).get(vendors[1]!.id)).toBe(false);
  expect((await riderPickupAvailability(env,foreignUni,vendors.map(v=>v.id))).size).toBe(0);
 });
});
