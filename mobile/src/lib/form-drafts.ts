import { draftAttachment, draftFormatError, draftIdentifier, draftRecord, draftRows, draftString } from './draft-fields';
import { listingPhotos } from './listing-photos';
const strings = <const Keys extends readonly string[]>(row: Record<string, unknown>, keys: Keys): Record<Keys[number], string> => Object.fromEntries(keys.map(key => [key, draftString(row, key)])) as Record<Keys[number], string>;
export function restoreListingDraft(value: unknown) {
  const row = draftRecord(value), fields = strings(row, ['name', 'description', 'price', 'stock', 'code', 'location', 'category']);
  return { ...fields, requestPayload: draftString(row, 'requestPayload', '', 64000), images: listingPhotos(row.images, draftString(row, 'image')), requestId: draftIdentifier(row, 'requestId'), createdId: draftIdentifier(row, 'createdId') };
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
