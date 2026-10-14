import {sql} from 'drizzle-orm';
import {database} from './database';
import {reconcilePricedStore} from './commerce-pricing';
import {reconcilePricedTutorial} from './tutorial-pricing';
import {reconcileMaterial} from './material-commerce';
import type {Bindings} from '../types';

/** Existing references only. Missed redirects/webhooks cannot strand a receipt. */
export async function reconcileDueCollections(env:Bindings) {
  if(env.PHASE_3_SCHEMA_READY!=='true')return {checked:0,failed:0};
  const attempts=await database(env).execute<{reference:string;resource_type:string}>(sql`
    select provider_reference as reference,resource_type from public.payment_attempts
    where status in ('CREATED','INITIALIZED') and created_at>now()-interval '7 days'
      and created_at<now()-interval '30 seconds' and updated_at<now()-interval '4 minutes'
    order by updated_at,created_at limit 8
  `);
  let failed=0;
  for(let i=0;i<attempts.rows.length;i+=2)await Promise.all(attempts.rows.slice(i,i+2).map(async attempt=>{
    try {
      if(attempt.resource_type==='STORE_ORDER')await reconcilePricedStore(env,attempt.reference);
      else if(attempt.resource_type==='TUTORIAL_BOOKING')await reconcilePricedTutorial(env,attempt.reference);
      else if(attempt.resource_type==='TUTORIAL_PURCHASE')await reconcileMaterial(env,attempt.reference);
    } catch(error) {
      failed++;
      console.warn(JSON.stringify({event:'payment.receipt.reconciliation_failed',code:(error as {code?:string}).code??'VERIFICATION_FAILED'}));
    } finally {
      await database(env).execute(sql`update public.payment_attempts set updated_at=now() where provider_reference=${attempt.reference} and status in ('CREATED','INITIALIZED')`);
    }
  }));
  return {checked:attempts.rows.length,failed};
}
