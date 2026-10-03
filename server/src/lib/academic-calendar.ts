export type AcademicDate = { title:string; starts_on:string; ends_on:string; semester:string };
export type ExamPeriod = { semester:string; startsOn:string; endsOn:string; status:"upcoming"|"ongoing"|"completed" };
export function extractExamPeriods(events: AcademicDate[], today = new Date(Date.now()+60*60*1000).toISOString().slice(0,10)): ExamPeriod[] {
  const periods: ExamPeriod[] = [];
  for (const event of [...events].filter(event => /\bexam(?:ination)?s?\b/i.test(event.title)).sort((a,b)=>a.starts_on.localeCompare(b.starts_on))) {
    const semester=event.semester.trim() || "Examinations";
    // Calendars often print faculty, general, GST and CED exams as separate rows.
    // Merge adjacent windows, but never turn two distant semesters into one exam period.
    const previous=[...periods].reverse().find(period => period.semester===semester && Date.parse(event.starts_on)-Date.parse(period.endsOn)<=21*86400000);
    if(previous) previous.endsOn=previous.endsOn>event.ends_on ? previous.endsOn : event.ends_on;
    else periods.push({semester,startsOn:event.starts_on,endsOn:event.ends_on,status:"upcoming"});
  }
  return periods.map(period=>({...period,status:today<period.startsOn ? "upcoming" : today>period.endsOn ? "completed" : "ongoing"}));
}
