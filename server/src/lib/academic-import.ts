import { timetableEntrySchema } from '@kampusone/contracts';
import { AIProviderError } from './ai-error';
import { parseScheduleDocument } from './schedule-document';
import { parseExamDocument } from './exam-schedule';
import { courseKey, gridTimetableEntries, incompleteSchedule, readScheduleJSON, scheduleCoverage, type TimetableScope } from './timetable-extraction';

/** One validation path for the real upload route and live release checks. */
export function parseAcademicImport(text: string, sourceText = '', kind?: 'class' | 'calendar' | 'exam', options: { strict?: boolean; scope?: TimetableScope } = {}) {
  const value = readScheduleJSON(text), scope = options.scope ?? {};
  const coverage = options.strict ? scheduleCoverage(value) : undefined;
  const grid = kind !== 'exam' && value.documentType === 'class_timetable' && value.grid !== undefined;
  const sourceEntries = grid ? gridTimetableEntries(value, scope) : undefined;
  const extracted = kind === 'exam' ? parseExamDocument(text) : parseScheduleDocument(sourceEntries ? JSON.stringify({ ...value, entries: sourceEntries }) : text, sourceText);
  if (kind === 'calendar' && extracted.documentType !== 'academic_calendar')
    throw new AIProviderError(422, 'AI_INVALID_OUTPUT', 'This document was not recognised as an academic calendar. Nothing has been saved.');
  if (options.strict) {
    if (extracted.documentType === 'unknown') throw incompleteSchedule('This document was not recognised as a readable schedule. Your file is kept. No import credit was used.');
    if (!grid && coverage!.rowCount !== (extracted.documentType === 'academic_calendar' ? extracted.events.length : extracted.entries.length)) throw incompleteSchedule();
    if (extracted.documentType === 'academic_calendar' && !extracted.events.length) throw incompleteSchedule();
  }
  if (kind === 'exam') {
    if (options.strict && !extracted.entries.length) throw incompleteSchedule();
    return extracted;
  }
  const entries: unknown[] = [], warnings = [...extracted.warnings], seen = new Set<string>();
  for (const [i, raw] of extracted.entries.entries()) {
    if (!raw || typeof raw !== 'object') { warnings.push(`Class ${i + 1} was unreadable and needs manual entry.`); continue; }
    const row = raw as Record<string, unknown>;
    const normalized = { ...row, courseCode: row.courseCode ?? '', venue: row.venue ?? '', lecturer: row.lecturer ?? '', reminderMinutes: 15, reminderEnabled: true };
    const valid = timetableEntrySchema.safeParse(normalized);
    if (!valid.success || typeof row.startsAt !== 'string' || typeof row.endsAt !== 'string'
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.startsAt) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.endsAt) || row.endsAt <= row.startsAt) {
      warnings.push(`Class ${i + 1} has missing or invalid details; add or correct it manually.`); continue;
    }
    const identity = JSON.stringify([valid.data.courseCode || valid.data.title, valid.data.dayOfWeek, valid.data.startsAt, valid.data.endsAt, valid.data.venue]);
    if (seen.has(identity)) { warnings.push(`Class ${i + 1} repeats an earlier row and was skipped.`); continue; }
    seen.add(identity); entries.push(valid.data);
  }
  if (options.strict && extracted.documentType === 'class_timetable') {
    if (!entries.length || entries.length !== extracted.entries.length) throw incompleteSchedule();
    const days = new Set(entries.map(entry => (entry as { dayOfWeek: number }).dayOfWeek));
    if (!grid && (days.size !== coverage!.daysRead.length || [...days].some(day => !coverage!.daysRead.includes(day)))) throw incompleteSchedule();
  }
  if (!grid && scope.courseCodes?.length && extracted.documentType === 'class_timetable') {
    const chosen = entries.filter(entry => scope.courseCodes!.some(code => courseKey(code) === courseKey((entry as {courseCode: string}).courseCode)));
    if (!chosen.length) throw incompleteSchedule('No classes matching your course codes were verified. Check your selection. No import credit was used.');
    return { ...extracted, entries: chosen, warnings };
  }
  return { ...extracted, entries, warnings };
}
