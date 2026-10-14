import { generateAI, type AIEnvironment, type AIMedia } from '../src/lib/ai-provider';
import { parseAcademicImport } from '../src/lib/academic-import';
import { readPrivateAIPdf } from '../src/lib/ai-pdf-reader';
import { examImportInstruction } from '../src/lib/exam-schedule';
import { decodeAIText } from '../src/lib/ai-document';

/** Live checks use the app's actual inference and validation adapters, not a
 * short transcription request that cannot certify a structured schedule. */
export async function verifyAcademicImports(env: AIEnvironment, fixtures: {
  printedImage: string; handwriting: string; calendarPdf: string;
}) {
  const checked = async (name: string, kind: 'class' | 'calendar' | 'exam', prompt: string, media?: AIMedia, sourceDocument = false) => {
    const start = Date.now();
    try {
      const generated = await generateAI({ ...env, AI_ASSISTANT_ENABLED: 'true' }, {
        mode: 'timetable', tier: 'pro', prompt, sourceDocument, media, deadline: Date.now() + 150000,
        systemContext: kind === 'exam' ? examImportInstruction : kind === 'calendar'
          ? 'This import is an academic calendar. Extract every dated activity in both semesters, never weekly classes.'
          : 'Import this weekly class timetable. Student notes: I am in 100 level.',
      });
      const result = parseAcademicImport(generated.text, prompt, kind);
      const valid = kind === 'calendar' ? result.documentType === 'academic_calendar' && result.entries.length === 0
        && result.events.length === 8 && result.events.some(event => event.startsOn === '2027-02-01')
        : kind === 'exam' ? result.entries.length === 3 && (result.entries[0] as {date:string}).date === '2026-11-05'
        : result.documentType === 'class_timetable' && result.entries.some(entry => (entry as {courseCode:string}).courseCode.replace(/\s/g,'') === 'MAT101');
      return { name, outcome: valid ? 'extraction_succeeded' : 'extraction_unusable', classes: result.entries.length,
        events: result.events.length, elapsedMs: Date.now() - start };
    } catch (error) {
      return { name, outcome: 'extraction_failed', elapsedMs: Date.now() - start,
        ...((error as {reason?:string}).reason?.match(/^AI_[A-Z_]+$/) ? {reason:(error as {reason:string}).reason} : {}) };
    }
  };
  const calendarBytes = Uint8Array.from(atob(fixtures.calendarPdf), c => c.charCodeAt(0));
  const calendar = await readPrivateAIPdf(env, calendarBytes);
  const exams = decodeAIText(new TextEncoder().encode('EXAM TIMETABLE 2026.\nMAT 101 Mathematics; 2026-11-05; 09:00-11:00; Main hall.\nCSC 101 Computing; 2026-11-06; 12:00-14:00; LT 1.\nPHY 101 Physics; 2026-11-09; 09:00-11:00; LT 2.'));
  return Promise.all([
    checked('classImage', 'class', '', {mimeType:'image/png',data:fixtures.printedImage}),
    checked('handwrittenClass', 'class', '', {mimeType:'image/png',data:fixtures.handwriting}),
    checked('calendarPdf', 'calendar', calendar, undefined, true),
    checked('examText', 'exam', exams, undefined, true),
  ]);
}
