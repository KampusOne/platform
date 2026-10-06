import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { currentUser, requireAuth } from "../middleware/auth";
import { input, id } from "../lib/input";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import { requireFeature } from "../lib/features";
import { recordAudit } from "../lib/audit";
import {
  materialCommerceReady,
  materialQuoteSchema,
  materialQuote,
  initializeMaterialPayment,
} from "../lib/material-commerce";
import type { Bindings, Variables } from "../types";
export const tutorCommerceRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
tutorCommerceRoutes.use("/*", requireAuth);
tutorCommerceRoutes.use("/*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  await next();
});
async function ready(env: Bindings) {
  if (!(await materialCommerceReady(env)))
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Paid learning materials are awaiting the scheduled database update.",
    );
}
tutorCommerceRoutes.post("/quote", async (c) => {
  requireFeature(c.env, "TUTORIALS_ENABLED", "Learning checkout is paused.");
  requireFeature(c.env, "PAYMENTS_ENABLED", "Payments are not open yet.");
  await ready(c.env);
  const data = await input(c, materialQuoteSchema);
  return c.json({ quote: await materialQuote(c.env, currentUser(c), data) });
});
tutorCommerceRoutes.post("/purchases", async (c) => {
  requireFeature(c.env, "TUTORIALS_ENABLED", "Learning checkout is paused.");
  requireFeature(c.env, "PAYMENTS_ENABLED", "Payments are not open yet.");
  await ready(c.env);
  const d = await input(c, z.object({ quoteId: z.string().uuid() }).strict()),
    user = currentUser(c);
  try {
    const purchase = firstRow(
      await database(c.env).execute<{
        id: string;
        status: string;
        amount_kobo: number;
        tutor_user_id: string;
      }>(
        sql`select * from app_private.create_material_purchase(${d.quoteId}::uuid,${user.id}::uuid,${user.universityId}::uuid)`,
      ),
    );
    if (!purchase)
      throw new AppError(
        409,
        "CONFLICT",
        "This purchase could not be saved. Refresh its quote.",
      );
    await recordAudit(c.env, {
      actorUserId: user.id,
      universityId: user.universityId,
      action: "tutorial_material.purchase.created",
      targetType: "tutorial_material_purchase",
      targetId: purchase.id,
      requestId: c.get("requestId"),
      metadata: { amountKobo: purchase.amount_kobo, status: purchase.status },
    });
    return c.json(
      {
        purchase: {
          id: purchase.id,
          status: purchase.status,
          amountKobo: Number(purchase.amount_kobo),
        },
      },
      201,
    );
  } catch (e) {
    if (
      e instanceof Error &&
      /QUOTE_EXPIRED|QUOTE_PRICE_CHANGED|QUOTE_UNAVAILABLE|MATERIAL_UNAVAILABLE/.test(
        e.message,
      )
    )
      throw new AppError(
        409,
        "CONFLICT",
        "The material or its price changed. Refresh it before buying.",
      );
    throw e;
  }
});
tutorCommerceRoutes.post("/purchases/:id/payment", async (c) => {
  requireFeature(c.env, "PAYMENTS_ENABLED", "Payments are not open yet.");
  await ready(c.env);
  const user = currentUser(c),
    d = await input(c, z.object({ requestId: z.string().uuid() }).strict());
  try {
    return c.json(
      await initializeMaterialPayment(
        c.env,
        user,
        id(c.req.param("id")),
        d.requestId,
      ),
    );
  } catch (e) {
    if (e instanceof Error && /PAYMENT_NOT_PENDING/.test(e.message))
      throw new AppError(
        409,
        "CONFLICT",
        "This purchase is not waiting for payment. Check its saved status.",
      );
    throw e;
  }
});
tutorCommerceRoutes.get("/purchases", async (c) => {
  if (!(await materialCommerceReady(c.env)))
    return c.json({ ready: false, purchases: [], nextCursor: null });
  const user = currentUser(c),
    cursor = c.req.query("before");
  let before: { createdAt: string; id: string } | null = null;
  if (cursor) {
    try {
      before = z
        .object({
          createdAt: z.iso.datetime({ offset: true }),
          id: z.string().uuid(),
        })
        .parse(JSON.parse(atob(cursor)));
    } catch {
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Refresh the purchase list to start a new page.",
      );
    }
  }
  const purchases = await database(c.env).execute<{
    id: string;
    created_at: string;
  }>(sql`
    select p.id,p.title,p.status,p.amount_kobo,p.listed_kobo as price_kobo,0::integer as buyer_fee_kobo,p.resource_id,r.resource_type,
      null::uuid as listing_id,p.media_object_id,p.tutor_user_id,coalesce(a.display_name,'KampusOne tutor') as tutor_name,
      p.release_at,p.paid_at as access_starts_at,null::timestamptz as access_ends_at,p.created_at,
      p.payment_expires_at,
      case when p.status='PAID' then 'ACTIVE' when p.status='DISPUTED' then 'ON_HOLD' when p.status='PENDING_PAYMENT' and p.payment_expires_at<=now() then 'EXPIRED' else p.status end as access_status,
      (p.status='PAID' and r.status='PUBLISHED' and r.deleted_at is null and not exists(select 1 from public.user_blocks b where
        (b.blocker_id=${user.id}::uuid and b.blocked_id=p.tutor_user_id)or(b.blocker_id=p.tutor_user_id and b.blocked_id=${user.id}::uuid))) as can_access_resource,
      latest.provider_reference as reference,latest.status as payment_status
    from app_private.tutorial_material_purchases p join public.tutorial_resources r on r.id=p.resource_id
      left join public.agent_profiles a on a.id=r.tutor_profile_id
      left join lateral(select provider_reference,status from public.payment_attempts where resource_type='TUTORIAL_PURCHASE' and resource_id=p.id order by created_at desc limit 1)latest on true
    where p.student_user_id=${user.id}::uuid and p.university_id=${user.universityId}::uuid
      and (${before?.createdAt ?? null}::timestamptz is null or(p.created_at,p.id)<(${before?.createdAt ?? null}::timestamptz,${before?.id ?? null}::uuid))
    order by p.created_at desc,p.id desc limit 51
  `);
  const rows = purchases.rows.slice(0, 50),
    last = rows.at(-1);
  return c.json({
    ready: true,
    purchases: rows,
    nextCursor:
      purchases.rows.length > 50 && last
        ? btoa(
            JSON.stringify({
              createdAt: new Date(last.created_at).toISOString(),
              id: last.id,
            }),
          )
        : null,
  });
});
tutorCommerceRoutes.post("/purchases/:id/dispute", async (c) => {
  await ready(c.env);
  const user = currentUser(c),
    d = await input(
      c,
      z.object({ reason: z.string().trim().min(10).max(1000) }).strict(),
    );
  try {
    const dispute = firstRow(
      await database(c.env).execute<{ id: string }>(
        sql`select app_private.open_material_dispute(${crypto.randomUUID()}::uuid,${id(c.req.param("id"))}::uuid,${user.id}::uuid,${user.universityId}::uuid,${d.reason}) as id`,
      ),
    );
    await recordAudit(c.env, {
      actorUserId: user.id,
      universityId: user.universityId,
      action: "tutorial_material.dispute.opened",
      targetType: "dispute",
      targetId: dispute!.id,
      requestId: c.get("requestId"),
    });
    return c.json({ id: dispute!.id, status: "OPEN" }, 201);
  } catch (e) {
    if (
      e instanceof Error &&
      /PURCHASE_UNAVAILABLE|DISPUTE_WINDOW_CLOSED/.test(e.message)
    )
      throw new AppError(
        409,
        "CONFLICT",
        "This purchase is not eligible for a new dispute. Existing reports remain with support.",
      );
    throw e;
  }
});
