import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from '@kampusone/contracts';
import { database, firstRow } from '../lib/database';
import { resolveAdminScope } from '../lib/admin-access';
import { recordAudit } from '../lib/audit';
import { AppError } from '../lib/errors';
import { hashOtp } from '../lib/security';
import { currentUser } from '../middleware/auth';
import type { Bindings, Variables } from '../types';

export const orderOperationsRoutes = new Hono<{Bindings:Bindings;Variables:Variables}>();
orderOperationsRoutes.get('/', async c => {
 const user=currentUser(c), scope=await resolveAdminScope(c.env,user,c.req.query('universityId'),'marketplace.view');
 const status=c.req.query('status')??'ACTIVE';
 const orders=await database(c.env).execute(sql`
 select o.id,o.status,o.fulfilment_mode,o.total_kobo,o.created_at,o.updated_at,
   d.recipient_name,d.recipient_phone_e164,d.delivery_location,
   (select count(distinct p.vendor_profile_id)::int from public.order_items i join public.vendor_products p on p.id=i.product_id where i.order_id=o.id) vendor_count,
   (select sum(i.quantity)::int from public.order_items i where i.order_id=o.id) item_count
 from public.orders o left join public.order_delivery_snapshots d on d.order_id=o.id
 where (${scope}::uuid is null or o.university_id=${scope}::uuid)
 and case when ${status}='ACTIVE' then o.status in('PAID','ACCEPTED','READY','IN_DELIVERY','DISPUTED') when ${status}='ALL' then true else o.status=${status} end
 order by o.created_at desc limit 200`);
 return c.json({orders:orders.rows});
});
orderOperationsRoutes.get('/:id',async c=>{
 const user=currentUser(c),scope=await resolveAdminScope(c.env,user,c.req.query('universityId'),'marketplace.view');
 const parsed=z.string().uuid().safeParse(c.req.param('id'));if(!parsed.success)throw new AppError(400,'BAD_REQUEST','Choose a valid order.');
 const order=firstRow(await database(c.env).execute<{id:string;university_id:string}>(sql`
 select o.*,d.recipient_name,d.recipient_phone_e164,d.delivery_location,d.delivery_landmark,
 q.request_payload->>'pickupPointName' pickup_point
 from public.orders o left join public.order_delivery_snapshots d on d.order_id=o.id
 left join app_private.order_price_snapshots ps on ps.order_id=o.id
 left join app_private.store_checkout_quotes q on q.id=ps.quote_id
 where o.id=${parsed.data}::uuid and (${scope}::uuid is null or o.university_id=${scope}::uuid)`));
 if(!order)throw new AppError(404,'NOT_FOUND','That order is outside your campus scope.');
 const results=await Promise.all([
 database(c.env).execute(sql`select i.product_id,i.quantity,i.unit_price_kobo,p.name,p.image_url,p.vendor_profile_id from public.order_items i join public.vendor_products p on p.id=i.product_id where i.order_id=${order.id}::uuid order by p.vendor_profile_id,p.name`),
 database(c.env).execute(sql`select distinct a.id,a.display_name,s.contact_phone_e164,a.public_details->>'whatsapp' whatsapp,s.pickup_location,coalesce(v.status,o.status) preparation_status,v.ready_at from public.orders o join public.order_items i on i.order_id=o.id join public.vendor_products p on p.id=i.product_id join public.agent_profiles a on a.id=p.vendor_profile_id left join public.vendor_storefronts s on s.vendor_profile_id=a.id left join app_private.order_vendor_allocations v on v.order_id=o.id and v.vendor_profile_id=a.id where o.id=${order.id}::uuid`),
 database(c.env).execute(sql`select j.id,j.status,j.request_posted_at,a.display_name rider_name,a.public_details->>'phone' rider_phone from public.delivery_jobs j left join public.agent_profiles a on a.id=j.rider_profile_id where j.order_id=${order.id}::uuid`),
 database(c.env).execute(sql`select status,note,source,occurred_at from public.order_status_events where order_id=${order.id}::uuid order by occurred_at,id`),
 ]);
 return c.json({order,items:results[0].rows,vendors:results[1].rows,delivery:firstRow(results[2])??null,timeline:results[3].rows});
});
orderOperationsRoutes.post('/:id/action',async c=>{
 const user=currentUser(c),scope=await resolveAdminScope(c.env,user,undefined,'marketplace.manage');
 const schema=z.object({action:z.enum(['READY','SEND_TO_RIDERS','CAMPUS_DISPATCH','COMPLETE']),code:z.string().regex(/^\d{6}$/).optional()}).strict();
 const parsed=schema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success||!z.string().uuid().safeParse(c.req.param('id')).success)throw new AppError(400,'BAD_REQUEST','Choose an order action and enter a six-digit buyer code when completing.');
 if(parsed.data.action==='COMPLETE'&&!parsed.data.code)throw new AppError(400,'BAD_REQUEST','Enter the buyer’s handoff code to verify delivery.');
 const result=firstRow(await database(c.env).execute<{result:string}>(sql`select app_private.coordinate_campus_order(${c.req.param('id')}::uuid,${scope}::uuid,${parsed.data.action},${parsed.data.code?await hashOtp(c.env,parsed.data.code):null}) result`))?.result;
 if(result==='INCORRECT')throw new AppError(400,'BAD_REQUEST','That buyer handoff code is incorrect.');
 if(result==='LOCKED')throw new AppError(429,'RATE_LIMITED','The buyer handoff code is expired or locked. Use support to resolve it.');
 if(result!=='OK')throw new AppError(409,'CONFLICT','The order changed or is not ready for this action. Refresh its details.');
 await recordAudit(c.env,{actorUserId:user.id,universityId:scope,action:'order.campus_'+parsed.data.action.toLowerCase(),targetType:'order',targetId:c.req.param('id'),requestId:c.get('requestId')});
 return c.json({status:'updated'});
});
