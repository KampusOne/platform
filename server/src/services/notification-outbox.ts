import {notificationRuntime} from './notification-runtime';
import { sql } from "drizzle-orm";
import { database } from "../lib/database";
import type { Bindings } from "../types";
import { renderTransactionalEmail } from "../lib/email-template";
export async function deliverQueuedNotifications(env: Bindings) {
  if (
    env.UNIFIED_SCHEMA_READY !== "true" ||
    !env.RESEND_API_KEY ||
    !env.RESEND_FROM_EMAIL
  )
    return { sent: 0 };
  const db = database(env);
  // An elapsed suspension also restores access; its service email is durable and deduplicated.
  await db.execute(sql`insert into app_private.notification_outbox(user_id,channel,subject,body,dedupe_key)
    select r.user_id,'EMAIL','Your KampusOne account has been restored','Your suspension has ended and your KampusOne account has been restored. Open the app to continue. Contact support from account settings if you need help.','account-restored:'||r.id::text
    from public.account_restrictions r join public.users u on u.id=r.user_id and u.deleted_at is null
    where r.kind='SUSPENDED' and r.revoked_at is null and r.ends_at<=now() and r.ends_at>now()-interval '1 day'
      and not exists(select 1 from public.account_restrictions other where other.user_id=r.user_id and other.revoked_at is null and other.starts_at<=now()and(other.ends_at is null or other.ends_at>now()))
    on conflict(dedupe_key)do nothing`);
  const claimed = await db.execute<{
    id: string;
    user_id: string;
    subject: string;
    body: string;
    dedupe_key: string;
    attempts: number;
  }>(
    sql`with ready as(select id from app_private.notification_outbox where channel='EMAIL' and state in('PENDING','PROCESSING') and next_attempt_at<=now() and attempts<8 order by next_attempt_at limit 25 for update skip locked) update app_private.notification_outbox o set state='PROCESSING',attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' from ready where o.id=ready.id returning o.*`,
  );
  let sent = 0;
  // Small bounded batches prevent a broadcast from overwhelming the mail provider.
  for (const row of claimed.rows) {
    try {
      const recipient = await db.execute<{ email: string;university_id:string|null }>(
        sql`select u.email,p.university_id from public.users u left join public.profiles p on p.user_id=u.id where u.id=${row.user_id}::uuid and u.deleted_at is null`,
      );
      const runtime=await notificationRuntime(env,recipient.rows[0]?.university_id??null);
      if(!runtime.email_enabled){await db.execute(sql`update app_private.notification_outbox set state='PENDING',attempts=greatest(attempts-1,0),next_attempt_at=now()+interval '5 minutes' where id=${row.id}::uuid`);continue;}
      const email = recipient.rows[0]?.email;
      if (!email) throw new Error("RECIPIENT_UNAVAILABLE");
      const rendered = renderTransactionalEmail({
        subject: row.subject,
        label: "Account update",
        heading: row.subject,
        intro: row.body,
        note: "For help with your account, open Support in KampusOne settings.",
      });
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.RESEND_API_KEY,
          "Content-Type": "application/json",
          "Idempotency-Key": row.dedupe_key,
        },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          from: env.RESEND_FROM_EMAIL,
          to: [email],
          subject: row.subject,
          ...rendered,
        }),
      });
      if (!response.ok) throw new Error("EMAIL_DELIVERY_FAILED");
      await db.execute(
        sql`update app_private.notification_outbox set state='SENT' where id=${row.id}::uuid`,
      );
      sent++;
    } catch {
      await db.execute(
        sql`update app_private.notification_outbox set state=case when attempts>=8 then 'FAILED' else 'PENDING' end,next_attempt_at=now()+make_interval(mins=>least(360,power(2,attempts)::int)) where id=${row.id}::uuid`,
      );
    }
  }
  return { sent };
}
