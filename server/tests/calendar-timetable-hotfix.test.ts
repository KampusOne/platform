import { describe, expect, it } from "vitest";
import { aiSystemInstruction } from "../src/lib/ai-provider";
import { parseScheduleDocument } from "../src/lib/schedule-document";

describe("calendar/timetable hotfix", () => {
  it("keeps academic calendar dates out of hourly timetable entries", () => {
    const result = parseScheduleDocument(
      JSON.stringify({
        documentType: "academic_calendar",
        entries: [
          {
            title: "First Semester",
            dayOfWeek: 1,
            startsAt: "05:00",
            endsAt: "16:00",
          },
        ],
        events: [
          {
            title: "Registration",
            startsOn: "2026-01-05",
            endsOn: "2026-01-16",
            semester: "First semester",
          },
        ],
        warnings: [],
      }),
      "APPROVED ACADEMIC CALENDAR",
    );

    expect(result.documentType).toBe("academic_calendar");
    expect(result.entries).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.title).toBe("Registration");
  });

  it("requires the model to classify academic calendars separately", () => {
    const instruction = aiSystemInstruction("timetable");
    expect(instruction).toContain("academic_calendar");
    expect(instruction).toContain("entries MUST be empty");
  });
});
