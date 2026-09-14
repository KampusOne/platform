import { sql } from "drizzle-orm";
import { database } from "../lib/database";
import type { Bindings } from "../types";
export async function deliverQueuedNotifications(env: Bindings) {
  if (
    env.UNIFIED_SCHEMA_READY !== "true" ||
    !env.RESEND_API_KEY ||
    !env.RESEND_FROM_EMAIL
  )
    return { sent: 0 };
  const db = database(env);
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
      const recipient = await db.execute<{ email: string }>(
        sql`select email from public.users where id=${row.user_id}::uuid and deleted_at is null`,
      );
      const email = recipient.rows[0]?.email;
      if (!email) throw new Error("RECIPIENT_UNAVAILABLE");
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
          text: row.body,
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
