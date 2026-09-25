import { z } from "@kampusone/contracts";
import { AIProviderError } from "./ai-error.ts";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + "T12:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Use a real calendar date");
export const calendarEventSchema = z.object({
  title: z.string().trim().min(1).max(160), startsOn: date, endsOn: date,
  semester: z.string().trim().max(80).default(""),
}).strict().refine(event => event.endsOn >= event.startsOn, "Check the event dates");
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export const scheduleInstruction = `Read the entire document, including every semester and page, before extracting it.
Classify it as class_timetable (weekly classes with explicit hours), academic_calendar (dated registration, lectures, examinations, breaks or holidays), or unknown.
Return JSON only: {"documentType":"class_timetable|academic_calendar|unknown","entries":[],"events":[],"warnings":[]}.
For class_timetable, each entry has title, courseCode, venue, lecturer, dayOfWeek (Sunday=0 to Saturday=6), startsAt and endsAt in 24-hour HH:MM. Copy readable days and hours only. Optional text may be empty. Never infer a class time from a date or invent a course from a heading. "First Semester" and "Second Semester" are headings, never classes.
For academic_calendar, entries MUST be empty. Each event has title, startsOn, endsOn (YYYY-MM-DD), semester (heading text or empty). Preserve every readable activity row in every semester, including overlapping rows. For a dated holiday with a blank end date use its single start date as endsOn. Never turn a range of lecture dates into recurring classes. The user needs a separate lecture timetable for hourly classes. Do not invent hours, rooms or lecturers. If a row is unclear, omit it and identify it in warnings. Check dates against weekday labels and warn about contradictions without silently changing the printed date. A proposed next-session start may be a one-day event labelled "Proposed".
Example: "FIRST SEMESTER / Mon 5 Jan 2026 to Fri 16 Jan 2026 / Registration" becomes an academic_calendar event with startsOn "2026-01-05", endsOn "2026-01-16", title "Registration", semester "First semester" and no class entries. Never extract 05:00 or 16:00 from those dates.
Return unknown with empty entries/events if the document is not a readable schedule.`;

export function parseScheduleDocument(text: string, sourceText = "") {
  let value: Record<string, unknown>;
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new AIProviderError(502, "AI_INVALID_OUTPUT", "The schedule response could not be read. Your source is kept; try a clearer image."); }
  if (!value || typeof value !== "object" || !Array.isArray(value.entries)) throw new AIProviderError(502, "AI_INVALID_OUTPUT", "No valid schedule was returned. Nothing has been saved.");
  const warnings = Array.isArray(value.warnings) ? value.warnings.filter((w): w is string => typeof w === "string").slice(0, 80).map(w => w.slice(0, 300)) : [];
  // Defence against older models confusing a calendar date (5 Jan) with 05:00.
  const calendarSource = /academic\s+calendar/i.test(sourceText) && !/\b\d{1,2}:\d{2}\s*(?:am|pm)?\s*[-–]/i.test(sourceText);
  const documentType = calendarSource ? "academic_calendar" : ["academic_calendar", "class_timetable", "unknown"].includes(String(value.documentType)) ? String(value.documentType) : "class_timetable";
  if (value.entries.length > 40 || (Array.isArray(value.events) && value.events.length > 80)) throw new AIProviderError(422, "AI_TOO_MANY_CLASSES", "Import a smaller section of this schedule.");
  const entries = documentType === "class_timetable" ? value.entries.filter(entry => {
    const heading = !entry || typeof entry !== "object" || /^(?:(?:first|second|third|1st|2nd|3rd)\s+semester|semester\s+\d|academic\s+calendar|registration|\d+\s+weeks?\s+(?:lectures?|examinations?))\b/i.test(String(entry.title ?? "").trim());
    if (heading) warnings.push("A heading or calendar activity was skipped. Only classes with printed days and times can be imported.");
    return !heading;
  }) : [];
  const events: CalendarEvent[] = [];
  if (documentType === "academic_calendar") {
    for (const [index, event] of (Array.isArray(value.events) ? value.events : []).entries()) {
      const parsed = calendarEventSchema.safeParse(event);
      if (parsed.success) events.push(parsed.data);
      else warnings.push(`Calendar row ${index + 1} needs clearer dates or a title. It was not imported.`);
    }
    if (!events.length) warnings.push("This is an academic calendar. No hourly classes were created. Try a clearer copy to extract its dates.");
  }
  return { documentType, entries, events, warnings };
}
