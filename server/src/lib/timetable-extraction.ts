import { z } from '@kampusone/contracts';
import { AIProviderError } from './ai-error.ts';

export type TimetableScope = { level?: string; courseCodes?: string[]; department?: string; programme?: string };
export const courseKey = (value: string) => value.replace(/\s+/g, '').toUpperCase();
export const levelKey = (value: unknown) => String(value ?? '').trim().replace(/\s*(?:level|lvl)\s*/gi, '');

/** Read table geometry first. The application, rather than a model's proposed
 * clock values, maps each cell span back to its printed column headers. */
export const timetableExtractionInstruction = `For a weekly class timetable, identify whether the source is a grid (courses in weekday/level rows under time columns) or a list (explicit day and time on each line).
For a GRID return entries:[] and grid:{"timeSlots":[{"startsAt":"08:00","endsAt":"09:00"}],"levels":["100","200"],"daysSeen":[1,2,3,4,5],"rows":[{"dayOfWeek":1,"level":"200","cells":[{"from":0,"to":1,"label":"MTH201"}]}]}.
Copy EVERY printed time column left to right, interpreting afternoon columns in 24-hour time (e.g. a column after 12.00-1.00 is 13:00-14:00). from is the zero-based first column; to is the exclusive column AFTER the last covered column. A merged cell spanning two columns is one cell, never a one-hour class. Include blank cells as label:"" so every column of every selected row is accounted for. Never slide a course left into a blank column. Copy the whole course label, including slash-separated codes, laboratories and parenthesised room names. Adjacent stacked courses in ONE cell are one shared class label, not successive hours.
daysSeen must list every weekday printed anywhere on the source. levels must list every printed level. Read only the requested level's row on EVERY printed day, plus cells explicitly shared with that row. Repeat the printed level in each row. Do not mix a nearby level's courses into the selected row. A faculty seminar spanning other levels does not apply to the selected level. Do not infer department eligibility from a course prefix. Do not filter course cells during transcription; the application filters the student's selected courses afterwards.
If the grid has no level labels, use levels:[] and level:""; do not invent a level. If multiple levels are visible but no level is requested, do not choose one arbitrarily; mark the extraction incomplete.
For a LIST use ordinary entries with explicit dayOfWeek, startsAt, endsAt, courseCode, title, venue and lecturer; never manufacture missing clocks or weekdays. For every schedule type include coverage:{"complete":true,"daysRead":[1,2,3,4,5],"rowCount":5,"uncertain":[]}. For a grid rowCount is the number of weekday/level rows transcribed (including empty rows), daysRead equals all printed weekdays. For a list rowCount is the number of class entries; daysRead contains every weekday on the source. For a calendar or exam rowCount is the number of event/paper entries and daysRead may be empty.
If ANY selected row, cell, weekday, time header or page was skipped, cut off, illegible or uncertain, set complete:false and identify it in uncertain. Never return half a schedule as complete; never advise importing it in pieces. Warnings can mention a missing optional venue or lecturer, but cannot justify missing courses or hours.`;

const day = z.number().int().min(0).max(6);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const timeSlotsSchema = z.array(z.object({ startsAt: clock, endsAt: clock })).min(1).max(24);
export function verifiedTimetableTimeSlots(value: unknown) {
  const parsed = timeSlotsSchema.safeParse(value);
  if (!parsed.success) throw incompleteSchedule('The printed time headings could not be read. Your file is kept; no import credit was used.');
  for (const [i, slot] of parsed.data.entries()) {
    if (slot.endsAt <= slot.startsAt || (i > 0 && slot.startsAt < parsed.data[i - 1]!.endsAt))
      throw incompleteSchedule('The printed time headings could not be verified. Your file is kept; no import credit was used.');
  }
  return parsed.data;
}
const coverageSchema = z.object({
  complete: z.literal(true), daysRead: z.array(day).max(7), rowCount: z.number().int().min(1).max(80),
  uncertain: z.array(z.string()).max(0),
});
const gridSchema = z.object({
  timeSlots: timeSlotsSchema,
  levels: z.array(z.string().max(40)).max(20), daysSeen: z.array(day).min(1).max(7),
  rows: z.array(z.object({ dayOfWeek: day, level: z.string().max(40),
    cells: z.array(z.object({ from: z.number().int().min(0), to: z.number().int().min(1), label: z.string().trim().max(160) })).min(1).max(24),
  })).min(1).max(14),
});
export function incompleteSchedule(message = 'The complete schedule could not be verified. Your file is kept; retry without losing an import credit.') {
  return new AIProviderError(422, 'AI_INCOMPLETE_SCHEDULE', message);
}
export function readScheduleJSON(text: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw incompleteSchedule(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw incompleteSchedule();
  return value as Record<string, unknown>;
}
export function scheduleCoverage(value: Record<string, unknown>) {
  const parsed = coverageSchema.safeParse(value.coverage);
  if (!parsed.success || new Set(parsed.data.daysRead).size !== parsed.data.daysRead.length) throw incompleteSchedule();
  // Older/contradictory model output sometimes calls a partial extraction a
  // success while admitting omitted rows in prose. Keep that failure visible.
  const warnings = Array.isArray(value.warnings) ? value.warnings.filter(w => typeof w === 'string') : [];
  if (warnings.some(w => {
    const optionalOnly = /\b(venue|room|lecturer)\b/i.test(w) && !/\b(row|class|course|time|date|day|page|schedule|timetable)\b/i.test(w);
    return !optionalOnly && /\b(partial|incomplete|truncated|cut\s+(?:off|short)|timed?\s*out|timeout|unreadable|illegible|uncertain|omit(?:ted)?|skip(?:ped)?|smaller\s+(?:section|part)|half\s+(?:schedule|timetable))\b/i.test(w);
  })) throw incompleteSchedule();
  return parsed.data;
}

export function gridTimetableEntries(value: Record<string, unknown>, scope: TimetableScope) {
  const coverage = scheduleCoverage(value), parsed = gridSchema.safeParse(value.grid);
  if (!parsed.success) throw incompleteSchedule();
  const grid = parsed.data, level = levelKey(scope.level), levels = grid.levels.map(levelKey);
  if (levels.length > 1 && !level) throw new AIProviderError(422, 'AI_LEVEL_REQUIRED', 'This timetable has several levels. Choose the level to import. No import credit was used.');
  if (levels.length && level && !levels.includes(level)) throw new AIProviderError(422, 'AI_LEVEL_NOT_FOUND', 'The selected level is not on this timetable. Check your level and choose the correct document. No import credit was used.');
  const selected = levels.length ? level || levels[0] : '';
  if (new Set(grid.daysSeen).size !== grid.daysSeen.length || grid.daysSeen.length !== coverage.daysRead.length
    || grid.daysSeen.some(d => !coverage.daysRead.includes(d)) || coverage.rowCount !== grid.rows.length
    || grid.rows.length !== grid.daysSeen.length) throw incompleteSchedule();
  verifiedTimetableTimeSlots(grid.timeSlots);
  const seenDays = new Set<number>(), entries = [];
  for (const row of grid.rows) {
    if (seenDays.has(row.dayOfWeek) || !grid.daysSeen.includes(row.dayOfWeek) || levelKey(row.level) !== selected) throw incompleteSchedule('The timetable contains missing days or mixed level rows. Your file is kept; retry without losing an import credit.');
    seenDays.add(row.dayOfWeek);
    let next = 0;
    for (const cell of row.cells) {
      if (cell.from !== next || cell.to <= cell.from || cell.to > grid.timeSlots.length) throw incompleteSchedule();
      // A course cannot span a gap in the printed clock headings.
      for (let c = cell.from + 1; c < cell.to; c++) if (grid.timeSlots[c]!.startsAt !== grid.timeSlots[c - 1]!.endsAt) throw incompleteSchedule();
      next = cell.to;
      if (!cell.label) continue;
      const codes = cell.label.match(/\b[A-Z]{2,8}\s*\d{3,4}[A-Z]?\b/gi) ?? [];
      // A room such as ELA201 is not a course code. Preserve it in the label.
      const courseCodes = codes.filter(code => !/^(?:ELA|LT)\s*\d/i.test(code));
      const matches = scope.courseCodes?.length ? courseCodes.filter(code => scope.courseCodes!.some(wanted => courseKey(wanted) === courseKey(code))) : courseCodes;
      if (scope.courseCodes?.length && !matches.length && !/\blaboratory\b/i.test(cell.label)) continue;
      const bracket = /\(([^)]+)\)/.exec(cell.label)?.[1] ?? '';
      const room = /^(?:ELA|LT)\s*\d|\b(?:room|hall|theatre|laboratory)\b/i.test(bracket) ? bracket : '';
      entries.push({ title: cell.label, courseCode: matches.join('/'), venue: room, lecturer: '', dayOfWeek: row.dayOfWeek,
        startsAt: grid.timeSlots[cell.from]!.startsAt, endsAt: grid.timeSlots[cell.to - 1]!.endsAt });
    }
    if (next !== grid.timeSlots.length) throw incompleteSchedule();
  }
  if (!entries.length) throw incompleteSchedule('No classes matching your selection were verified. Check your level and course codes. No import credit was used.');
  return entries;
}
