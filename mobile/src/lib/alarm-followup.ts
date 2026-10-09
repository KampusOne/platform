export type AlarmFollowupKind = "CLASS" | "EXAM" | "OTHER";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** All academic alarm dates use Africa/Lagos, regardless of the device's zone. */
export function campusDateKey(milliseconds = Date.now()): string {
  return new Date(milliseconds + 3_600_000).toISOString().slice(0, 10);
}

export function validExamId(value: unknown): boolean {
  return typeof value === "string" && UUID.test(value);
}

/** Timetable ownership beats a stale/misrouted examId parameter. */
export function alarmFollowupKind(input: {
  timetableEntryId?: unknown;
  examId?: unknown;
  classStartsAt?: unknown;
  courseCode?: unknown;
}): AlarmFollowupKind {
  if (typeof input.timetableEntryId === "string" && input.timetableEntryId.length > 0) return "CLASS";
  if (validExamId(input.examId)) return "EXAM";
  if ((typeof input.classStartsAt === "string" && input.classStartsAt.length > 0)
      || (typeof input.courseCode === "string" && input.courseCode.length > 0)) return "CLASS";
  return "OTHER";
}
