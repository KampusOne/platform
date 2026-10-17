import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { tutorialListingSchema, z } from '@kampusone/contracts';
import { database, firstRow } from '../lib/database';
import { AppError } from '../lib/errors';
import { requireFeature } from '../lib/features';
import { id, input } from '../lib/input';
import { currentUser } from '../middleware/auth';
import type { Bindings, Variables } from '../types';

// Mounted inside agentRoutes, after its per-request TUTOR role/suspension guard.
export const tutorManagementRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const revisionSchema = z.string().min(1).max(80);
const materialEditSchema = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(10).max(2000),
  courseCode: z.string().trim().toUpperCase().min(2).max(24),
  subject: z.string().trim().min(2).max(80),
  accessModel: z.enum(['FREE', 'BOOKING_INCLUDED', 'PAID']),
  priceKobo: z.number().int().min(0).max(100_000_000),
  coverUrl: z.string().url().nullable(),
  expectedRevision: revisionSchema,
}).strict();

tutorManagementRoutes.patch('/tutorial-resources/:id', async c => {
  requireFeature(c.env, 'TUTORIALS_ENABLED', 'Learning material editing is unavailable.');
  const user = currentUser(c), resourceId = id(c.req.param('id'));
  const data = await input(c, materialEditSchema);
  if (data.accessModel === 'PAID' ? data.priceKobo <= 0 : data.priceKobo !== 0)
    throw new AppError(400, 'BAD_REQUEST', 'Set a price for paid materials, or choose Free.');
  if (data.accessModel === 'PAID') requireFeature(c.env, 'PAYMENTS_ENABLED', 'Paid learning materials are unavailable.');
  const coverId = data.coverUrl ? new URL(data.coverUrl).pathname.match(/\/v1\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1] ?? null : null;

  // Legacy covers may be retained. A changed cover must be this owner's campus image.
  const result = firstRow(await database(c.env).execute<{ id: string; revision: string }>(sql`
    update public.tutorial_resources r set title=${data.title}, description=${data.description},
      course_id=case when r.course_code<>${data.courseCode} then null else r.course_id end,
      course_code=${data.courseCode}, subject=${data.subject}, access_model=${data.accessModel},
      price_kobo=${data.priceKobo}, cover_url=${data.coverUrl},
      updated_at=greatest(clock_timestamp(),r.updated_at+interval '1 microsecond')
    from public.agent_profiles p
    where r.id=${resourceId}::uuid and r.tutor_profile_id=p.id
      and p.user_id=${user.id}::uuid and p.university_id=${user.universityId}::uuid
      and r.university_id=p.university_id and p.agent_type='TUTOR' and p.status='ACTIVE'
      and r.deleted_at is null and r.status in ('DRAFT','REJECTED','PUBLISHED')
      and r.updated_at::text=${data.expectedRevision}
      and (${data.accessModel}<>'BOOKING_INCLUDED' or r.listing_id is not null)
      and (${data.coverUrl}::text is null or r.cover_url is not distinct from ${data.coverUrl}
        or exists(select 1 from public.media_objects m
          where m.id=${coverId}::uuid
            and m.owner_user_id=${user.id}::uuid and m.institution_id=${user.universityId}::uuid
            and m.kind='product' and m.content_type like 'image/%' and m.deleted_at is null))
    returning r.id,r.updated_at::text as revision
  `));
  if (!result) throw new AppError(409, 'CONFLICT', 'This material changed or is unavailable. Reload its latest details and use a cover uploaded by your account.');
  return c.json(result);
});

tutorManagementRoutes.patch('/tutorials/:id', async c => {
  requireFeature(c.env, 'TUTORIALS_ENABLED', 'Tutorial editing is unavailable.');
  const user = currentUser(c), listingId = id(c.req.param('id'));
  const data = await input(c, tutorialListingSchema.extend({ expectedRevision: revisionSchema }).strict());
  if (data.priceKobo > 0) requireFeature(c.env, 'PAYMENTS_ENABLED', 'Paid tutorials are unavailable.');
  const result = firstRow(await database(c.env).execute<{ id: string; revision: string }>(sql`
    update public.tutorial_listings l set title=${data.title},description=${data.description},
      course_id=case when l.course_code<>${data.courseCode} then null else l.course_id end,
      course_code=${data.courseCode},format=${data.format},price_kobo=${data.priceKobo},
      capacity=${data.capacity},location_text=${data.locationText ?? null},
      cancellation_cutoff_hours=${data.cancellationCutoffHours},
      updated_at=greatest(clock_timestamp(),l.updated_at+interval '1 microsecond')
    from public.agent_profiles p
    where l.id=${listingId}::uuid and l.tutor_profile_id=p.id
      and p.user_id=${user.id}::uuid and p.university_id=${user.universityId}::uuid
      and l.university_id=p.university_id and p.agent_type='TUTOR' and p.status='ACTIVE'
      and l.deleted_at is null and l.status in ('DRAFT','REJECTED','PAUSED','PUBLISHED')
      and l.updated_at::text=${data.expectedRevision}
    returning l.id,l.updated_at::text as revision
  `));
  if (!result) throw new AppError(409, 'CONFLICT', 'This tutorial changed or is unavailable. Reload its latest details before saving.');
  return c.json(result);
});

tutorManagementRoutes.delete('/tutorials/:id', async c => {
  requireFeature(c.env, 'TUTORIALS_ENABLED', 'Tutorial management is unavailable.');
  const user = currentUser(c), listingId = id(c.req.param('id'));
  const result = firstRow(await database(c.env).execute<{ id: string }>(sql`
    update public.tutorial_listings l set status='ARCHIVED',
      deleted_at=coalesce(l.deleted_at,now()),updated_at=now()
    from public.agent_profiles p
    where l.id=${listingId}::uuid and l.tutor_profile_id=p.id
      and p.user_id=${user.id}::uuid and p.university_id=${user.universityId}::uuid
      and l.university_id=p.university_id and p.agent_type='TUTOR' and p.status='ACTIVE'
    returning l.id
  `));
  if (!result) throw new AppError(404, 'NOT_FOUND', 'This tutorial is unavailable.');
  return c.json({ status: 'DELETED' });
});
