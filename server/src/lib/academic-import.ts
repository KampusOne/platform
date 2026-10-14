import { timetableEntrySchema } from '@kampusone/contracts';
import { AIProviderError } from './ai-error';
import { parseScheduleDocument } from './schedule-document';
import { parseExamDocument } from './exam-schedule';

/** One validation path for the real upload route and live release checks. */
export function parseAcademicImport(text: string, sourceText = '', kind?: 'class' | 'calendar' | 'exam') {
  const extracted = kind === 'exam' ? parseExamDocument(text) : parseScheduleDocument(text, sourceText);
  if (kind === 'calendar' && extracted.documentType !== 'academic_calendar')
    throw new AIProviderError(422, 'AI_INVALID_OUTPUT', 'This document was not recognised as an academic calendar. Nothing has been saved.');
  if (kind === 'exam') return extracted;
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
  return { ...extracted, entries, warnings };
}
