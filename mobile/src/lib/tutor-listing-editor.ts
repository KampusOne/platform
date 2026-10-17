import { nairaToKobo } from './money-input';
import { draftRecord, draftString } from './draft-fields';

export type TutorListing = {
  id: string; title: string; description: string; course_code: string; price_kobo: number;
  status: string; revision: string; resource_type?: string; cover_url?: string | null;
  subject?: string; access_model?: string; format?: string; capacity?: number;
  location_text?: string | null; cancellation_cutoff_hours?: number;
};
export type TutorEditForm = {
  title: string; description: string; courseCode: string; price: string; subject: string;
  access: string; cover: string; format: string; capacity: string; location: string; cutoff: string;
};
export function tutorEditForm(row: TutorListing): TutorEditForm {
  return { title: row.title, description: row.description, courseCode: row.course_code,
    price: String(Number(row.price_kobo) / 100), subject: row.subject ?? 'General studies',
    access: row.access_model ?? 'FREE', cover: row.cover_url ?? '', format: row.format ?? 'IN_PERSON',
    capacity: String(row.capacity ?? 20), location: row.location_text ?? '', cutoff: String(row.cancellation_cutoff_hours ?? 2) };
}
export function restoreTutorEditDraft(value: unknown): { form: TutorEditForm; revision: string } {
  const record = draftRecord(value), fields = draftRecord(record.form);
  const form = Object.fromEntries(Object.entries({ title: 180, description: 2000, courseCode: 24, price: 20, subject: 80,
    access: 30, cover: 4096, format: 30, capacity: 8, location: 160, cutoff: 8 }).map(([key, max]) => [key, draftString(fields, key, '', max)])) as TutorEditForm;
  const revision = draftString(record, 'revision', '', 80);
  if (!revision) throw new Error('Your saved edit could not be restored. Its saved copy has been kept.');
  return { form, revision };
}
export function tutorEditPayload(row: TutorListing, form: TutorEditForm, revision: string) {
  const material = Boolean(row.resource_type);
  const title = form.title.trim(), description = form.description.trim(), courseCode = form.courseCode.trim().toUpperCase();
  if (title.length < 3 || title.length > (material ? 180 : 160)) throw new Error('Add a title of at least 3 characters.');
  if (description.length < (material ? 10 : 20)) throw new Error(`Add a description of at least ${material ? 10 : 20} characters.`);
  if (courseCode.length < 2) throw new Error('Add a course code, or use GENERAL.');
  const priceKobo = material && form.access !== 'PAID' ? 0 : nairaToKobo(form.price);
  if (priceKobo > 100_000_000) throw new Error('The maximum price is ₦1,000,000.');
  const common = { title, description, courseCode, priceKobo, expectedRevision: revision };
  if (material) {
    if (!['FREE', 'PAID', 'BOOKING_INCLUDED'].includes(form.access)) throw new Error('Choose how students can access this material.');
    if (form.access === 'PAID' && priceKobo <= 0) throw new Error('Add a price for this paid material.');
    if (form.subject.trim().length < 2) throw new Error('Add a subject for this material.');
    return { ...common, subject: form.subject.trim(), accessModel: form.access, coverUrl: form.cover || null };
  }
  if (!['IN_PERSON', 'ONLINE', 'HYBRID'].includes(form.format)) throw new Error('Choose the tutorial format.');
  const capacity = Number(form.capacity), cancellationCutoffHours = Number(form.cutoff);
  if (!/^\d+$/.test(form.capacity) || !Number.isInteger(capacity) || capacity < 1 || capacity > 500) throw new Error('Capacity must be between 1 and 500 learners.');
  if (!/^\d+$/.test(form.cutoff) || !Number.isInteger(cancellationCutoffHours) || cancellationCutoffHours < 0 || cancellationCutoffHours > 168) throw new Error('The cancellation cutoff must be between 0 and 168 hours.');
  return { ...common, format: form.format, capacity, locationText: form.location.trim() || null, cancellationCutoffHours };
}
export function tutorEditMatches(row: TutorListing, data: ReturnType<typeof tutorEditPayload>) {
  if (row.status === 'ARCHIVED' || row.title !== data.title || row.description !== data.description
    || row.course_code.toUpperCase() !== data.courseCode || Number(row.price_kobo) !== data.priceKobo) return false;
  return 'accessModel' in data ? row.access_model === data.accessModel && row.subject === data.subject && (row.cover_url ?? null) === data.coverUrl
    : row.format === data.format && Number(row.capacity) === data.capacity && (row.location_text ?? null) === data.locationText
      && Number(row.cancellation_cutoff_hours) === data.cancellationCutoffHours;
}
