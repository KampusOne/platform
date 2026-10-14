import { sql } from 'drizzle-orm';
import { database } from '../src/lib/database';
import { verifyCollection } from '../src/lib/collection-provider';
import type { Bindings } from '../src/types';

/** Protected deployment diagnostic. No initialization, payout or balance edits. */
export async function verifySavedStorePayments(env: Bindings) {
  const attempts = await database(env).execute<{reference:string;order_id:string;status:string}>(sql`
    select a.provider_reference as reference,a.resource_id as order_id,a.status
    from public.payment_attempts a where a.resource_type='STORE_ORDER'
      and a.created_at>now()-interval '2 days' and a.status in ('CREATED','INITIALIZED','REQUIRES_REVIEW')
    order by a.created_at desc limit 10
  `);
  return Promise.all(attempts.rows.map(async attempt => {
    try {
      const receipt=await verifyCollection(env,attempt.reference);
      return {order:attempt.order_id,reference:attempt.reference,paymentStatus:attempt.status,
        providerStatus:receipt.status,amountKobo:receipt.amountKobo,feeKobo:receipt.feeKobo,paidAt:receipt.paidAt};
    } catch (error) {
      return {order:attempt.order_id,paymentStatus:attempt.status,code:(error as {code?:string}).code??'VERIFICATION_FAILED'};
    }
  }));
}
