import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z, directMessageInputSchema } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { input, id } from "../lib/input";
import { AppError } from "../lib/errors";
import { sha256 } from "../lib/security";
import { currentUser, requireAuth } from "../middleware/auth";
import {
  requireProfileSafety,
  requireUnblocked,
  unblockedAuthor,
} from "../lib/profile-safety";
import type { Bindings, Variables } from "../types";

export const messageRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

messageRoutes.use("/*", requireAuth);
messageRoutes.use("/*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  await requireProfileSafety(c.env);
  await next();
});

type Thread = {
  id: string;
  initiator_id: string;
  recipient_id: string;
  status: string;
  kind: "GENERAL";
  access_ends_at: null;
};

async function threadFor(env: Bindings, userId: string, threadId: string) {
  const thread = firstRow(
    await database(env).execute<Thread>(sql`
      select
        id,
        initiator_id,
        recipient_id,
        status,
        'GENERAL'::text as kind,
        null::timestamptz as access_ends_at
      from public.direct_threads
      where id=${threadId}::uuid
        and ${userId}::uuid in (initiator_id,recipient_id)
    `),
  );
  if (!thread) throw new AppError(404, "NOT_FOUND", "Conversation not found.");
  await requireUnblocked(
    env,
    userId,
    thread.initiator_id === userId ? thread.recipient_id : thread.initiator_id,
  );
  return thread;
}

messageRoutes.get("/inbox", async (c) => {
  const user = currentUser(c);
  const filter = z
    .enum(["All", "Unread", "Requests", "Tutor", "Vendor", "Rider"])
    .safeParse(c.req.query("filter") ?? "All");
  if (!filter.success) {
    throw new AppError(400, "BAD_REQUEST", "Choose a conversation filter.");
  }

  let cursor: { at: string; id: string } | undefined;
  const before = c.req.query("before");
  if (before) {
    try {
      cursor = z
        .object({ at: z.string().datetime(), id: z.string().uuid() })
        .strict()
        .parse(JSON.parse(atob(before)));
    } catch {
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Refresh conversations before loading more.",
      );
    }
  }

  const db = database(c.env);
  const visibility = sql`
    ${user.id}::uuid in(t.initiator_id,t.recipient_id)
    and t.status<>'DECLINED'
    and p.deleted_at is null
    and ${unblockedAuthor(user.id, sql`p.user_id`)}
  `;

  const [rows, total] = await Promise.all([
    db.execute(sql`
      select
        t.id,
        'GENERAL'::text as kind,
        t.status,
        t.initiator_id,
        t.recipient_id,
        t.updated_at,
        p.user_id,
        p.display_name,
        p.profile_image_url,
        to_char(t.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at,
        (select body from public.direct_messages m where m.thread_id=t.id order by m.created_at desc,m.id desc limit 1) as last_message,
        (select count(*)::int from public.direct_messages m where m.thread_id=t.id and m.sender_id<>${user.id}::uuid and m.read_at is null) as unread_count,
        coalesce((select json_agg(a.agent_type) from public.agent_profiles a where a.user_id=p.user_id and a.status='ACTIVE'),'[]'::json) as roles
      from public.direct_threads t
      join public.profiles p
        on p.user_id=case
          when t.initiator_id=${user.id}::uuid then t.recipient_id
          else t.initiator_id
        end
      where ${visibility}
        and (
          ${cursor?.at ?? null}::timestamptz is null
          or (t.updated_at,t.id)<(${cursor?.at ?? null}::timestamptz,${cursor?.id ?? null}::uuid)
        )
        and (
          ${filter.data}='All'
          or (
            ${filter.data}='Unread'
            and exists(
              select 1 from public.direct_messages m
              where m.thread_id=t.id
                and m.sender_id<>${user.id}::uuid
                and m.read_at is null
            )
          )
          or (
            ${filter.data}='Requests'
            and t.status='REQUESTED'
            and t.recipient_id=${user.id}::uuid
          )
          or (
            ${filter.data} in ('Tutor','Vendor','Rider')
            and exists(
              select 1 from public.agent_profiles a
              where a.user_id=p.user_id
                and a.status='ACTIVE'
                and a.agent_type::text=upper(${filter.data})
            )
          )
        )
      order by t.updated_at desc,t.id desc
      limit 51
    `),
    db.execute<{ count: number }>(sql`
      select count(*)::int as count
      from public.direct_messages m
      join public.direct_threads t on t.id=m.thread_id
      join public.profiles p
        on p.user_id=case
          when t.initiator_id=${user.id}::uuid then t.recipient_id
          else t.initiator_id
        end
      where ${visibility}
        and m.sender_id<>${user.id}::uuid
        and m.read_at is null
    `),
  ]);

  const page = rows.rows.slice(0, 50);
  const last = page.at(-1) as { cursor_at?: string; id?: string } | undefined;
  return c.json({
    threads: page.map((row) => {
      const { cursor_at: _cursorAt, ...thread } = row as Record<string, unknown>;
      return thread;
    }),
    nextCursor:
      rows.rows.length > 50 && last?.cursor_at && last.id
        ? btoa(JSON.stringify({ at: last.cursor_at, id: last.id }))
        : null,
    unreadCount: Number(firstRow(total)?.count ?? 0),
  });
});

messageRoutes.post("/threads", async (c) => {
  const user = currentUser(c);
  const data = await input(c, z.object({ userId: z.string().uuid() }).strict());
  if (data.userId === user.id) {
    throw new AppError(400, "BAD_REQUEST", "Choose another student.");
  }
  await requireUnblocked(c.env, user.id, data.userId);
  const db = database(c.env);
  const target = firstRow(
    await db.execute(sql`
      select p.user_id
      from public.profiles p
      join public.users account
        on account.id=p.user_id
       and account.status::text='ACTIVE'
      where p.user_id=${data.userId}::uuid
        and p.deleted_at is null
    `),
  );
  if (!target) {
    throw new AppError(404, "NOT_FOUND", "This profile is unavailable.");
  }

  const thread = firstRow(
    await db.execute(sql`
      insert into public.direct_threads(
        institution_id,initiator_id,recipient_id,status
      )
      values(
        ${user.universityId}::uuid,
        ${user.id}::uuid,
        ${data.userId}::uuid,
        case
          when exists(
            select 1 from public.profile_follows
            where follower_id=${data.userId}::uuid
              and followed_id=${user.id}::uuid
          )
          then 'ACCEPTED'
          else 'REQUESTED'
        end
      )
      on conflict(
        (least(initiator_id,recipient_id)),
        (greatest(initiator_id,recipient_id))
      )
      do update set updated_at=public.direct_threads.updated_at
      returning id,status
    `),
  );
  return c.json({ thread }, 201);
});

messageRoutes.get("/threads/:id", async (c) => {
  const user = currentUser(c);
  const thread = await threadFor(c.env, user.id, id(c.req.param("id")));
  const peer =
    thread.initiator_id === user.id
      ? thread.recipient_id
      : thread.initiator_id;
  const before = c.req.query("before") ? id(c.req.query("before")!) : null;

  const [messages, profile] = await Promise.all([
    database(c.env).execute(sql`
      select
        m.id,m.sender_id,m.body,m.created_at,m.read_at,m.media_id,
        case when media.deleted_at is null then media.content_type end as media_type,
        case when media.deleted_at is null then media.original_name end as media_name
      from public.direct_messages m
      left join public.media_objects media on media.id=m.media_id
      where m.thread_id=${thread.id}::uuid
        and (
          ${before}::uuid is null
          or (m.created_at,m.id)<(
            select created_at,id
            from public.direct_messages
            where id=${before}::uuid and thread_id=${thread.id}::uuid
          )
        )
      order by m.created_at desc,m.id desc
      limit 51
    `),
    database(c.env).execute(sql`
      select user_id,display_name,profile_image_url
      from public.profiles
      where user_id=${peer}::uuid and deleted_at is null
    `),
  ]);

  const page = messages.rows.slice(0, 50).reverse();
  return c.json({
    thread,
    messages: page,
    nextCursor: messages.rows.length > 50 ? (page[0] as { id?: string })?.id ?? null : null,
    profile: firstRow(profile),
  });
});

messageRoutes.put("/threads/:id/accept", async (c) => {
  const user = currentUser(c);
  const thread = await threadFor(c.env, user.id, id(c.req.param("id")));
  const data = await input(c, z.object({ accept: z.boolean() }).strict());
  if (thread.recipient_id !== user.id) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only the recipient can answer this request.",
    );
  }
  await database(c.env).execute(sql`
    update public.direct_threads
    set status=${data.accept ? "ACCEPTED" : "DECLINED"},updated_at=now()
    where id=${thread.id}::uuid and status='REQUESTED'
  `);
  return c.json({ status: data.accept ? "ACCEPTED" : "DECLINED" });
});

messageRoutes.put("/threads/:id/read", async (c) => {
  const user = currentUser(c);
  const thread = await threadFor(c.env, user.id, id(c.req.param("id")));
  await database(c.env).execute(sql`
    update public.direct_messages
    set read_at=coalesce(read_at,now())
    where thread_id=${thread.id}::uuid
      and sender_id<>${user.id}::uuid
      and read_at is null
  `);
  return c.json({ read: true });
});

messageRoutes.post("/threads/:id/messages", async (c) => {
  const user = currentUser(c);
  const thread = await threadFor(c.env, user.id, id(c.req.param("id")));
  const data = await input(c, directMessageInputSchema);
  const db = database(c.env);

  if (
    thread.status === "DECLINED" ||
    (thread.status === "REQUESTED" && thread.recipient_id === user.id)
  ) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Accept the request before replying.",
    );
  }

  if (data.mediaId) {
    if (thread.status !== "ACCEPTED") {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Attachments are available after the request is accepted.",
      );
    }
    const attachment = firstRow(
      await db.execute(sql`
        select id
        from public.media_objects
        where id=${data.mediaId}::uuid
          and owner_user_id=${user.id}::uuid
          and kind='message'
          and deleted_at is null
      `),
    );
    if (!attachment) {
      throw new AppError(
        404,
        "NOT_FOUND",
        "Choose an attachment uploaded by this account.",
      );
    }
  }

  const body = data.body || "Attachment";
  const allowed = firstRow(
    await db.execute<{ allowed: boolean }>(sql`
      select app_private.consume_request_rate_limit(
        'DIRECT_MESSAGE',
        ${await sha256(user.id)},
        60,
        60,
        60
      ) as allowed
    `),
  );
  if (!allowed?.allowed) {
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please slow down before sending another message.",
    );
  }

  const existing = firstRow(
    await db.execute<{
      id: string;
      body: string;
      media_id: string | null;
    }>(sql`
      select id,body,media_id
      from public.direct_messages
      where id=${data.id}::uuid
        and thread_id=${thread.id}::uuid
        and sender_id=${user.id}::uuid
    `),
  );
  if (existing) {
    if (
      existing.body !== body ||
      (existing.media_id ?? null) !== (data.mediaId ?? null)
    ) {
      throw new AppError(
        409,
        "CONFLICT",
        "This message identifier was already used.",
      );
    }
    return c.json({ message: existing });
  }

  if (
    thread.status === "REQUESTED" &&
    firstRow(
      await db.execute(sql`
        select 1 from public.direct_messages
        where thread_id=${thread.id}::uuid
        limit 1
      `),
    )
  ) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Wait for your message request to be accepted.",
    );
  }

  const result = firstRow(
    await db.execute<{
      id: string;
      sender_id: string;
      body: string;
      created_at: string;
    }>(sql`
      with inserted as (
        insert into public.direct_messages(
          id,thread_id,sender_id,body,media_id,request_preview
        )
        values(
          ${data.id}::uuid,
          ${thread.id}::uuid,
          ${user.id}::uuid,
          ${body},
          ${data.mediaId ?? null}::uuid,
          ${thread.status === "REQUESTED"}
        )
        on conflict do nothing
        returning *
      ),
      touched as (
        update public.direct_threads
        set updated_at=now()
        where id=${thread.id}::uuid
          and exists(select 1 from inserted)
      )
      select id,sender_id,body,created_at from inserted
    `),
  );
  if (!result) {
    throw new AppError(
      409,
      "CONFLICT",
      "This message was already sent, or your request is awaiting acceptance.",
    );
  }

  const recipient =
    thread.initiator_id === user.id
      ? thread.recipient_id
      : thread.initiator_id;
  await db.execute(sql`
    insert into public.in_app_notifications(
      user_id,institution_id,title,body,path,dedupe_key
    )
    select
      ${recipient}::uuid,
      recipient_profile.university_id,
      coalesce(sender_profile.display_name,sender_profile.username,'Someone')
        || ${thread.status === "REQUESTED"
          ? " sent you a message request"
          : " sent you a message"},
      ${body === "Attachment" ? "Sent an attachment." : body.slice(0, 180)},
      ${"/conversation?id=" + thread.id},
      ${"message:" + result.id}
    from public.profiles recipient_profile
    join public.profiles sender_profile
      on sender_profile.user_id=${user.id}::uuid
    where recipient_profile.user_id=${recipient}::uuid
      and recipient_profile.deleted_at is null
      and sender_profile.deleted_at is null
    on conflict do nothing
  `);

  return c.json({ message: result }, 201);
});
