import { draftAttachment, draftFormatError, draftIdentifier, draftRecord, draftRows, draftString } from './draft-fields';
import { listingPhotos } from './listing-photos';
import {calendarDraftFields} from './calendar-editor';
const strings = <const Keys extends readonly string[]>(row: Record<string, unknown>, keys: Keys): Record<Keys[number], string> => Object.fromEntries(keys.map(key => [key, draftString(row, key)])) as Record<Keys[number], string>;
export function restoreListingDraft(value: unknown) {
  const row = draftRecord(value), fields = strings(row, ['name', 'description', 'price', 'stock', 'code', 'location', 'category']);
  const revision=row.editRevision, stock=row.editStock;
  if ((revision !== undefined || stock !== undefined) &&
      (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1 || typeof stock !== 'number' || !Number.isSafeInteger(stock) || stock < 0 || stock > 1_000_000)) throw draftFormatError();
  return { ...fields, requestPayload: draftString(row, 'requestPayload', '', 64000), images: listingPhotos(row.images, draftString(row, 'image')), requestId: draftIdentifier(row, 'requestId'), createdId: draftIdentifier(row, 'createdId'),
    ...(typeof revision === 'number' && typeof stock === 'number' ? {editRevision:revision,editStock:stock} : {}) };
}
export function restoreTimetableDraft(value: unknown) {
  const row = draftRecord(value);
  const entries = draftRows(row, 'entries', 40, value => {
    const e = draftRecord(value), day = e.dayOfWeek, reminder = e.reminderMinutes ?? 15;
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6 || typeof reminder !== 'number' || !Number.isInteger(reminder) || reminder < 0 || reminder > 1440 || (e.reminderEnabled !== undefined && typeof e.reminderEnabled !== 'boolean')) throw draftFormatError();
    return { title: draftString(e, 'title'), courseCode: draftString(e, 'courseCode'), venue: draftString(e, 'venue'), lecturer: draftString(e, 'lecturer'), startsAt: draftString(e, 'startsAt'), endsAt: draftString(e, 'endsAt'), dayOfWeek: day, reminderMinutes: reminder, reminderEnabled: e.reminderEnabled !== false };
  });
  const events = draftRows(row, 'events', 100, value => {
    const e = draftRecord(value);
    return { title: draftString(e, 'title'), startsOn: draftString(e, 'startsOn'), endsOn: draftString(e, 'endsOn'), semester: draftString(e, 'semester') };
  });
  return { entries, events, documentType: draftString(row, 'documentType'), text: draftString(row, 'text'), notes: draftString(row, 'notes'), attachment: draftAttachment(row.attachment), warnings: draftRows(row, 'warnings', 100, value => { if (typeof value !== 'string') throw draftFormatError(); return value; }), key: draftIdentifier(row, 'key'), saveKey: draftIdentifier(row, 'saveKey') };
}
export function restoreExamDraft(value: unknown) {
  const row = draftRecord(value);
  return { papers: draftRows(row, 'papers', 80, value => {
    const p = draftRecord(value);
    return { title: draftString(p, 'title'), courseCode: draftString(p, 'courseCode'), date: draftString(p, 'date'), startsAt: draftString(p, 'startsAt'), endsAt: draftString(p, 'endsAt'), venue: draftString(p, 'venue') };
  }), text: draftString(row, 'text'), notes: draftString(row, 'notes'), file: draftAttachment(row.file), requestId: draftIdentifier(row, 'requestId'), saveId: draftIdentifier(row, 'saveId') };
}
export function restoreCampusDraft(value: unknown) {
  const row = draftRecord(value), kind = row.kind;
  if (!['EVENT', 'SPORTS', 'OPPORTUNITY'].includes(String(kind))) throw draftFormatError();
  return { kind: kind as 'EVENT' | 'SPORTS' | 'OPPORTUNITY', title: draftString(row, 'title'), description: draftString(row, 'description'), venue: draftString(row, 'venue'), date: draftString(row, 'date'), time: draftString(row, 'time'), link: draftString(row, 'link'), requestId: draftIdentifier(row, 'requestId'), images: draftRows(row, 'images', 5, value => {
    const image = draftRecord(value), id = draftIdentifier(image, 'id'), url = draftString(image, 'url'), kind = draftString(image, 'kind');
    if (!id || !url || kind !== 'post' || typeof image.private !== 'boolean') throw draftFormatError();
    return { id, url, kind, private: image.private };
  }) };
}
export function restoreOnboardingDraft(value: string) {
  const row = draftRecord(JSON.parse(value)), step = row.step ?? 0;
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 0 || step > 2) throw draftFormatError();
  return { ...strings(row, ['heardSource', 'heardOther', 'firstName', 'lastName', 'username', 'birthDate', 'matriculationNumber', 'currentLevel', 'admissionYear', 'graduationYear', 'universityId', 'facultyId', 'departmentId', 'courseId']), step };
}

export function restorePublisherDraft(value: unknown) {
  const row = draftRecord(value), format = row.format, hours = draftString(row, 'hours', '24', 4);
  if (!['POLL', 'QA', 'ANONYMOUS_QA'].includes(String(format)) || typeof row.anonymousPoll !== 'boolean' || !['24', '72', '168', '720'].includes(hours)) throw draftFormatError();
  const options = draftRows(row, 'options', 6, value => { if (typeof value !== 'string' || value.length > 100) throw draftFormatError(); return value; });
  if (options.length < 2) throw draftFormatError();
  const mediaId = draftIdentifier(row, 'mediaId'), mediaUrl = draftString(row, 'mediaUrl', '', 4096), closesAt = draftString(row, 'closesAt', '', 40);
  if (Boolean(mediaId) !== Boolean(mediaUrl) || (closesAt && !Number.isFinite(Date.parse(closesAt)))) throw draftFormatError();
  return { format: format as 'POLL' | 'QA' | 'ANONYMOUS_QA', anonymousPoll: row.anonymousPoll, body: draftString(row, 'body', '', 5000), options, hours, requestId: draftIdentifier(row, 'requestId'), closesAt: closesAt || undefined, ...(mediaId ? { mediaId, mediaUrl } : {}) };
}
export function restoreAnswerDraft(value: unknown) {
  const row = draftRecord(value);
  return { body: draftString(row, 'body', '', 3000), requestId: draftIdentifier(row, 'requestId') };
}
export function restorePersonalCalendar(value: string) {
  if(value.length>256*1024)throw draftFormatError();
  const rows:unknown=JSON.parse(value);
  if(!Array.isArray(rows))throw draftFormatError();
  const ids=new Set<string>();
  return rows.map(value=>{
    const row=draftRecord(value),id=draftString(row,'id','',160),title=draftString(row,'title'),starts_on=draftString(row,'starts_on','',10),ends_on=draftString(row,'ends_on','',10),semester=draftString(row,'semester');
    const realDate=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;
    if(!/^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|local:[a-z0-9_-]{1,128})$/i.test(id)||!title||ids.has(id)||!realDate(starts_on)||!realDate(ends_on)||ends_on<starts_on)throw draftFormatError();
    ids.add(id);const requestId=draftIdentifier(row,'requestId');
    const submittedEvent=row.submittedEvent===undefined?undefined:calendarDraftFields(row.submittedEvent),pendingBase=row.pendingBase===undefined?undefined:calendarDraftFields(row.pendingBase);
    return{id,title,starts_on,ends_on,semester,...(requestId?{requestId}:{}),...(submittedEvent?{submittedEvent}:{}),...(pendingBase?{pendingBase}:{})};
  });
}
/** Retain recoverable metadata, never private signed links, local URIs or extracted file bytes. */
export function retainedKiraAttachment(file: ReturnType<typeof draftAttachment>) {
  return file ? { name: file.name, type: file.type, ...(file.size !== undefined ? { size: file.size } : {}), ...(file.mediaId ? { mediaId: file.mediaId } : {}) } : undefined;
}
export function restoreKiraDraft(value: unknown) {
  const row = draftRecord(value), mode = row.mode, tier = row.tier;
  if (!['study', 'summary', 'explanation', 'notes', 'quiz'].includes(String(mode)) || !['standard', 'pro'].includes(String(tier)) || (row.pending !== undefined && typeof row.pending !== 'boolean')) throw draftFormatError();
  const replyTo=draftIdentifier(row,'replyTo');
  return { prompt: draftString(row, 'prompt'), mode: mode as 'study' | 'summary' | 'explanation' | 'notes' | 'quiz', attachment: retainedKiraAttachment(draftAttachment(row.attachment)), key: draftIdentifier(row, 'key'), pending:row.pending===true, ...(row.pending===true&&replyTo?{replyTo}:{}) };
}
