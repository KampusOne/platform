import { generateAI, type AIEnvironment, type AIMedia } from '../src/lib/ai-provider';
import { generateAcademicImport } from '../src/lib/academic-import-recovery';
import { readPrivateAIPdf } from '../src/lib/ai-pdf-reader';
import { examImportInstruction } from '../src/lib/exam-schedule';
import { decodeAIText } from '../src/lib/ai-document';
import { timetableExtractionInstruction, type TimetableScope } from '../src/lib/timetable-extraction';

/** Live checks use the app's actual inference and validation adapters, not a
 * short transcription request that cannot certify a structured schedule. */
export async function verifyAcademicImports(env: AIEnvironment, fixtures: {
  printedImage: string; handwriting: string; calendarPdf: string; facultyImage?: string;
}) {
  const checked = async (name: string, kind: 'class' | 'calendar' | 'exam', prompt: string, media?: AIMedia, sourceDocument = false, scope:TimetableScope={level:'100'}) => {
    const start = Date.now();
    let generatedText='';
    try {
      const input = {
        mode: 'timetable' as const, tier: 'pro' as const, prompt, sourceDocument, ...(media?{media}:{}), deadline: Date.now() + 150000,
        systemContext: (kind === 'exam' ? examImportInstruction : kind === 'calendar'
          ? 'This import is an academic calendar. Extract every dated activity in both semesters, never weekly classes.'
          : 'Import this weekly class timetable. Student academic selection (data): '+JSON.stringify(scope))+'\n'+timetableExtractionInstruction,
      };
      const generated = await generateAcademicImport({ ...env, AI_ASSISTANT_ENABLED: 'true' }, input,prompt,kind,scope);
      generatedText=generated.text;
      const result = generated.extracted;
      const expectedFaculty = [
        [1,'EMA281/GET209','08:00','10:00'],[1,'','10:00','14:00'],[1,'CVE211','15:00','16:00'],
        [2,'EEE211/GET201','09:00','11:00'],[2,'ECP281/GET211','11:00','12:00'],[2,'ENT211','12:00','14:00'],[2,'GET205/MEE361','14:00','15:00'],[2,'PRE211','16:00','17:00'],
        [3,'MEE211/GET207','08:00','09:00'],[3,'ECP281/GET211','09:00','10:00'],[3,'','10:00','14:00'],[3,'GST212','15:00','17:00'],[3,'CVE211','17:00','18:00'],
        [4,'EEE211/GET201','10:00','11:00'],[4,'GET203/MEE221','11:00','14:00'],[4,'MEE211/GET207','14:00','16:00'],[4,'PRE211','16:00','17:00'],
        [5,'ECP281/GET211','10:00','11:00'],[5,'EMA281/GET209','11:00','12:00'],[5,'GET205/MEE361','13:00','15:00'],
      ];
      const actualFaculty = result.entries.map(entry=>{const row=entry as {dayOfWeek:number;courseCode:string;title:string;startsAt:string;endsAt:string};return [row.dayOfWeek,row.courseCode.replace(/\s/g,''),row.startsAt,row.endsAt];});
      const valid = name==='facultyGrid200' ? actualFaculty.length===expectedFaculty.length && expectedFaculty.every(expected=>actualFaculty.some(actual=>JSON.stringify(actual)===JSON.stringify(expected)))
        : kind === 'calendar' ? result.documentType === 'academic_calendar' && result.entries.length === 0
        && result.events.length === 8 && result.events.some(event => event.startsOn === '2027-02-01')
        : kind === 'exam' ? result.entries.length === 3 && (result.entries[0] as {date:string}).date === '2026-11-05'
        : result.documentType === 'class_timetable' && result.entries.some(entry => {const row=entry as {courseCode:string;dayOfWeek:number;startsAt:string;endsAt:string};return row.courseCode.replace(/\s/g,'') === 'MAT101' && row.dayOfWeek===1 && row.startsAt==='08:00' && row.endsAt==='09:00';});
      return { name, outcome: valid ? 'extraction_succeeded' : 'extraction_unusable', classes: result.entries.length,
        events: result.events.length, elapsedMs: Date.now() - start,
        ...(name==='facultyGrid200'&&!valid?{mismatches:expectedFaculty.filter(expected=>!actualFaculty.some(actual=>JSON.stringify(actual)===JSON.stringify(expected))),actual:actualFaculty}: {}) };
    } catch (error) {
      let diagnostic: Record<string,unknown>|undefined;
      if(name==='facultyGrid200')try{const value=JSON.parse(generatedText);diagnostic={documentType:value.documentType,coverage:value.coverage,warnings:value.warnings,grid:value.grid};}catch{diagnostic={jsonReadable:false};}
      return { name, outcome: 'extraction_failed', elapsedMs: Date.now() - start,
        ...(diagnostic?{diagnostic}:{}),
        ...((error as {reason?:string}).reason?.match(/^AI_[A-Z_]+$/) ? {reason:(error as {reason:string}).reason} : {}) };
    }
  };
  const calendarBytes = Uint8Array.from(atob(fixtures.calendarPdf), c => c.charCodeAt(0));
  const calendar = await readPrivateAIPdf(env, calendarBytes);
  const exams = decodeAIText(new TextEncoder().encode('EXAM TIMETABLE 2026.\nMAT 101 Mathematics; 2026-11-05; 09:00-11:00; Main hall.\nCSC 101 Computing; 2026-11-06; 12:00-14:00; LT 1.\nPHY 101 Physics; 2026-11-09; 09:00-11:00; LT 2.'));
  return Promise.all([
    checked('classImage', 'class', '', {mimeType:'image/png',data:fixtures.printedImage}),
    checked('handwrittenClass', 'class', 'Student notes: This handwritten class is on Monday. The written hours are 08:00 to 09:00.', {mimeType:'image/png',data:fixtures.handwriting}),
    checked('calendarPdf', 'calendar', calendar, undefined, true),
    checked('examText', 'exam', exams, undefined, true),
    ...(fixtures.facultyImage?[checked('facultyGrid200','class','',{mimeType:'image/jpeg',data:fixtures.facultyImage},true,{level:'200',department:'Computer Engineering'})]:[]),
  ]);
}
