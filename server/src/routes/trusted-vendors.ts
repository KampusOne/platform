import { Hono } from 'hono';
import { z } from '@kampusone/contracts';
import { sql } from 'drizzle-orm';
import { database, firstRow } from '../lib/database';
import { currentUser, requireAuth } from '../middleware/auth';
import { resolveAdminScope } from '../lib/admin-access';
import { recordAudit } from '../lib/audit';
import { id, input } from '../lib/input';
import { AppError } from '../lib/errors';
import { agentOperationsSchema } from '../lib/agent-intake';
import { acquisitionSchema } from '../lib/acquisition';
import { ageOn } from '../lib/platform-policy';
import type { Bindings, Variables } from '../types';

export const trustedVendorRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const token = z.string().regex(/^[a-f0-9]{64}$/);
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(b => b.toString(16).padStart(2, '0')).join('');
async function campaign(env: Bindings) {
  return firstRow(await database(env).execute<{ enabled: boolean; updated_at: string }>(sql`select enabled,updated_at::text from app_private.agent_campaign_controls where campaign_key='exclusive'`));
}
async function requireCampaign(env: Bindings) {
  if (!(await campaign(env))?.enabled) throw new AppError(404, 'NOT_FOUND', 'Page not found.');
}
trustedVendorRoutes.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
// Public availability allows the Next server to return a real 404 before rendering login.
trustedVendorRoutes.get('/availability', async c => c.json({ enabled: (await campaign(c.env))?.enabled === true }));
trustedVendorRoutes.use('/invite', async (c, next) => { await requireCampaign(c.env); await next(); });
trustedVendorRoutes.use('/submit', async (c, next) => { await requireCampaign(c.env); await next(); });
trustedVendorRoutes.use('*', requireAuth);

trustedVendorRoutes.get('/admin/campaign', async c => {
  const scope = await resolveAdminScope(c.env, currentUser(c), undefined, 'agents.review');
  const state = await campaign(c.env);
  if (!state) throw new AppError(503, 'FEATURE_DISABLED', 'Campaign controls are unavailable. Please try again shortly.');
  return c.json({ ...state, canManage: scope === null });
});
trustedVendorRoutes.patch('/admin/campaign', async c => {
  const actor = currentUser(c), data = await input(c, z.object({ enabled: z.boolean() }).strict());
  const scope = await resolveAdminScope(c.env, actor, undefined, 'agents.review');
  if (scope !== null) throw new AppError(403, 'FORBIDDEN', 'A platform reviewer manages the Exclusive campaign for all universities.');
  const result = firstRow(await database(c.env).execute(sql`update app_private.agent_campaign_controls set enabled=${data.enabled},updated_by=${actor.id}::uuid,updated_at=now() where campaign_key='exclusive' returning enabled,updated_at::text`));
  if (!result) throw new AppError(503, 'FEATURE_DISABLED', 'Campaign controls are unavailable. Please try again shortly.');
  await recordAudit(c.env, { actorUserId: actor.id, universityId: null, action: 'exclusive_campaign.updated', targetType: 'agent_campaign', targetId: 'exclusive', requestId: c.get('requestId'), metadata: { enabled: data.enabled } });
  return c.json({ ...result, canManage: true });
});
trustedVendorRoutes.post('/invite', async c => {
  const data = await input(c, z.object({ token }).strict()), actor = currentUser(c);
  const invite = firstRow(await database(c.env).execute(sql`select i.id,i.institution_id,school.name university_name,i.expires_at,i.application_id from app_private.trusted_vendor_invites i join public.universities school on school.id=i.institution_id join public.users account on account.id=${actor.id}::uuid and lower(account.email)=lower(i.email) and account.email_verified_at is not null where i.token_hash=${await hash(data.token)} and i.revoked_at is null and(i.expires_at>now()or i.claimed_user_id=${actor.id}::uuid)`));
  if (!invite) throw new AppError(403, 'FORBIDDEN', 'This invitation is unavailable for your account. Sign in with the invited email.');
  return c.json({ invite });
});
const submission = z.object({
  token, requestId: z.string().uuid(), businessName: z.string().trim().min(2).max(160), legalName: z.string().trim().min(2).max(160),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => ageOn(value) >= 18 && ageOn(value) <= 110, 'Enter a valid date of birth. Exclusive applicants must be at least 18.'), description: z.string().trim().min(20).max(2000), address: z.string().trim().min(10).max(500),
  category: z.enum(['Restaurant', 'Supermarket', 'Groceries', 'Fashion', 'Beauty', 'Electronics', 'Printing', 'Other']), campus: z.string().trim().min(2).max(100),
  phone: z.string().regex(/^\+234[789]\d{9}$/), whatsapp: z.string().regex(/^\+234[789]\d{9}$/).optional(),
  acquisition: acquisitionSchema.optional(), operations: agentOperationsSchema, adultAuthorized: z.literal(true), terms: z.literal(true),
}).strict();
trustedVendorRoutes.post('/submit', async c => {
  const actor = currentUser(c), data = await input(c, submission), db = database(c.env);
  const allowed = firstRow(await db.execute<{ allowed: boolean }>(sql`select app_private.consume_request_rate_limit('TRUSTED_VENDOR_SUBMIT',${actor.id},10,3600,3600) allowed`));
  if (!allowed?.allowed) throw new AppError(429, 'RATE_LIMITED', 'Please wait before submitting again.');
  try {
    const { token: code, requestId, acquisition, ...values } = data, codeHash = await hash(code);
    const row = firstRow(await db.execute<{ id: string }>(sql`select app_private.submit_trusted_vendor_with_acquisition(${actor.id}::uuid,${codeHash},${requestId}::uuid,${JSON.stringify(values)}::jsonb,${acquisition?JSON.stringify(acquisition):null}::jsonb) id`));
    if (!row?.id) throw new AppError(409, 'CONFLICT', 'The invitation or application changed. Refresh and try again.');
    return c.json({ id: row.id, status: 'SUBMITTED' }, 201);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && /TRUSTED_CAMPAIGN_DISABLED/.test(error.message)) throw new AppError(404, 'NOT_FOUND', 'Page not found.');
    if (error instanceof Error && /TRUSTED_|agent_applications_university_id_user_id_agent_type_key/.test(error.message)) throw new AppError(409, 'CONFLICT', 'The invitation, age, business details or application changed. Check your answers or contact the inviting team.');
    throw error;
  }
});
trustedVendorRoutes.get('/admin', async c => {
  const scope = await resolveAdminScope(c.env, currentUser(c), c.req.query('universityId'), 'agents.review');
  const rows = await database(c.env).execute(sql`select a.id,a.university_id,a.user_id,a.display_name,a.legal_name,a.phone_e164,a.status,a.updated_at::text revision,t.birth_date,t.description,t.address,t.category,t.campus,t.whatsapp_phone,t.document_media_id,t.business_details,t.review_note,t.approved_at,u.email,i.reason invitation_reason from app_private.trusted_vendor_intakes t join public.agent_applications a on a.id=t.application_id join app_private.trusted_vendor_invites i on i.id=t.invite_id join public.users u on u.id=a.user_id where(${scope}::uuid is null or a.university_id=${scope}::uuid)order by a.submitted_at desc limit 100`);
  return c.json({ applications: rows.rows });
});
trustedVendorRoutes.post('/admin/invites', async c => {
  const actor = currentUser(c), data = await input(c, z.object({ universityId: z.string().uuid(), email: z.email(), reason: z.string().trim().min(10).max(2000) }).strict());
  await resolveAdminScope(c.env, actor, data.universityId, 'agents.review'); await requireCampaign(c.env);
  const bytes = crypto.getRandomValues(new Uint8Array(32)), value = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const row = firstRow(await database(c.env).execute<{ id: string }>(sql`insert into app_private.trusted_vendor_invites(institution_id,email,token_hash,created_by,reason,expires_at)values(${data.universityId}::uuid,${data.email.toLowerCase()},${await hash(value)},${actor.id}::uuid,${data.reason},now()+interval '7 days')returning id`));
  await recordAudit(c.env, { actorUserId: actor.id, universityId: data.universityId, action: 'trusted_vendor.invited', targetType: 'trusted_vendor_invite', targetId: row!.id, requestId: c.get('requestId'), metadata: { reason: data.reason } });
  return c.json({ id: row!.id, url: 'https://agents.kampusone.app/exclusive?invite=' + value, expiresInDays: 7 }, 201);
});
trustedVendorRoutes.post('/admin/:id/review', async c => {
  const actor = currentUser(c), applicationId = id(c.req.param('id')), data = await input(c, z.object({ revision: z.string().min(1), decision: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().min(20).max(2000).default('Administrator reviewed the submitted business details and authorised contact and approved this vendor.'), verifiedBusinessAndContact: z.literal(true) }).strict()), db = database(c.env);
  const application = firstRow(await db.execute<{ university_id: string; user_id: string }>(sql`select university_id,user_id from public.agent_applications where id=${applicationId}::uuid`));
  if (!application) throw new AppError(404, 'NOT_FOUND', 'Application not found.');
  await resolveAdminScope(c.env, actor, application.university_id, 'agents.review');
  const result = firstRow(await db.execute<{ result: string }>(sql`select app_private.review_trusted_vendor(${actor.id}::uuid,${applicationId}::uuid,${data.revision},${data.decision},${data.note},${c.get('requestId')}) result`));
  if (!['REVIEWED', 'EXISTING'].includes(result?.result ?? '')) throw new AppError(409, 'CONFLICT', 'The application or invitation changed. Refresh before reviewing.');
  await recordAudit(c.env, { actorUserId: actor.id, universityId: application.university_id, action: 'trusted_vendor.details_verified', targetType: 'agent_application', targetId: applicationId, requestId: c.get('requestId'), metadata: { decision: data.decision, documentWaiver: true, intakeMethod: 'EXCLUSIVE_QUESTIONS' } });
  return c.json({ status: data.decision });
});
