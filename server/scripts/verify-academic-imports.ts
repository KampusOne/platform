import { generateAI, type AIEnvironment, type AIMedia } from '../src/lib/ai-provider';
import { generateAcademicImport } from '../src/lib/academic-import-recovery';
import { readPrivateAIPdf } from '../src/lib/ai-pdf-reader';
import { examImportInstruction } from '../src/lib/exam-schedule';
import { decodeAIText } from '../src/lib/ai-document';
import { timetableExtractionInstruction, type TimetableScope } from '../src/lib/timetable-extraction';

/** Live checks use the app's actual inference and validation adapters, not a
 * short transcription request that cannot certify a structured schedule. */
export async function verifyAcademicImports(env: AIEnvironment, fixtures: {
  printedImage: string; handwriting: string; calendarPdf: string; facultyImage?: string; facultyWebp?: string; facultyPhoto?: string;
  case?: 'baseline'|'facultyGrid200'|'facultyGrid100'|'facultyWebp100'|'facultyPhoto100';
  provider?:'gateway';
}) {
  let alternativeCheck:Promise<Record<string,unknown>>|undefined;
  const checkAlternative=()=>alternativeCheck??=(async()=>{
    if(!env.HF_TOKEN||!env.HF_CHAT_MODEL)return{outcome:'configuration_missing'};
    try{
      const result=await generateAI({...env,AI:undefined,AI_ASSISTANT_ENABLED:'true',AI_TEXT_PROVIDER:'huggingface'},
        {mode:'study',prompt:'State 2 plus 2 briefly.',deadline:Date.now()+15000});
      return{outcome:result.text?'generation_succeeded':'generation_unusable'};
    }catch(error){return{outcome:'generation_failed',reason:(error as {reason?:string}).reason??'unknown'};}
  })();
  const checked = async (name: string, kind: 'class' | 'calendar' | 'exam', prompt: string, media?: AIMedia, sourceDocument = false, scope:TimetableScope={level:'100'}) => {
    const start = Date.now();
    let generatedText='';
    const reads:unknown[]=[];
    const providerFailures:unknown[]=[];
    const observedEnv={...env,AI:env.AI?{run:async(model:string,args:Record<string,unknown>,options?:{signal?:AbortSignal})=>{
      try{return await env.AI!.run(model,args,options);}catch(error){
        const message=error instanceof Error?error.message:'';
        const code=/\b\d{4}\b/.exec(message)?.[0];
        const name=error instanceof Error&&/^[A-Za-z0-9_]{1,60}$/.test(error.name)?error.name:'unknown';
        const hint=/daily free allocation|used up.*neurons|neuron.*(?:allowance|quota|limit)/i.test(message)?'service_allowance'
          :/temporarily at capacity|capacity temporarily|out of capacity/i.test(message)?'service_capacity':'unclassified';
        providerFailures.push({provider:'workers-ai',name,hint,...(code?{code}:{})});throw error;
      }
    },...(env.AI.toMarkdown?{toMarkdown:env.AI.toMarkdown.bind(env.AI)}:{})}:undefined};
    try {
      const input = {
        mode: 'timetable' as const, tier: 'pro' as const, prompt, sourceDocument, ...(media?{media}:{}), ...(fixtures.provider?{provider:fixtures.provider}:{}), deadline: Date.now() + 150000,
        systemContext: (kind === 'exam' ? examImportInstruction : kind === 'calendar'
          ? 'This import is an academic calendar. Extract every dated activity in both semesters, never weekly classes.'
          : 'Import this weekly class timetable. Student academic selection (data): '+JSON.stringify(scope))+'\n'+timetableExtractionInstruction,
        onProviderFailure:(failure:{provider:string;status:number;hint:string;parameter?:string})=>{providerFailures.push(failure);},
        onScheduleRead:(day:number|null,text:string)=>{generatedText=text;try{reads.push({day,value:JSON.parse(text)});}catch{reads.push({day,jsonReadable:false,length:text.length,publicFixturePrefix:text.slice(0,1500)});}},
      };
      const generated = await generateAcademicImport({ ...observedEnv, AI_ASSISTANT_ENABLED: 'true' }, input,prompt,kind,scope);
      generatedText=generated.text;
      const result = generated.extracted;
      const expectedFaculty200 = [
        [1,'EMA281/GET209','08:00','10:00'],[1,'','10:00','14:00'],[1,'CVE211','15:00','16:00'],
        [2,'EEE211/GET201','09:00','11:00'],[2,'ECP281/GET211','11:00','12:00'],[2,'ENT211','12:00','14:00'],[2,'GET205/MEE361','14:00','15:00'],[2,'PRE211','16:00','17:00'],
        [3,'MEE211/GET207','08:00','09:00'],[3,'ECP281/GET211','09:00','10:00'],[3,'','10:00','14:00'],[3,'GST212','15:00','17:00'],[3,'CVE211','17:00','18:00'],
        [4,'EEE211/GET201','10:00','11:00'],[4,'GET203/MEE221','11:00','14:00'],[4,'MEE211/GET207','14:00','16:00'],[4,'PRE211','16:00','17:00'],
        [5,'ECP281/GET211','10:00','11:00'],[5,'EMA281/GET209','11:00','12:00'],[5,'GET205/MEE361','13:00','15:00'],
      ];
      const expectedFaculty100 = [
        [1,'PHY101','08:00','09:00'],[1,'CHM101','09:00','10:00'],[1,'GST111','12:00','14:00'],[1,'MTH101','15:00','16:00'],
        [2,'STA112','08:00','10:00'],[2,'MTH102','10:00','11:00'],[2,'PHY104','11:00','12:00'],[2,'MTH102','12:00','13:00'],[2,'CHM101','13:00','14:00'],
        [3,'MTH101','09:00','10:00'],[3,'PHY101','11:00','12:00'],[3,'GST112','12:00','14:00'],
        [4,'GET101/ENS211','08:00','10:00'],[4,'PHY103','11:00','12:00'],[4,'MTH102','12:00','13:00'],
        [5,'MTH101','08:00','09:00'],[5,'PHY104','09:00','10:00'],[5,'STA112','10:00','11:00'],[5,'PHY103','11:00','12:00'],
      ];
      const expectedFaculty = name.endsWith('200') ? expectedFaculty200 : expectedFaculty100;
      const actualFaculty = result.entries.map(entry=>{const row=entry as {dayOfWeek:number;courseCode:string;title:string;startsAt:string;endsAt:string};return [row.dayOfWeek,row.courseCode.replace(/\s/g,''),row.startsAt,row.endsAt];});
      const valid = name.startsWith('faculty') ? actualFaculty.length===expectedFaculty.length && expectedFaculty.every(expected=>actualFaculty.some(actual=>JSON.stringify(actual)===JSON.stringify(expected)))
        : kind === 'calendar' ? result.documentType === 'academic_calendar' && result.entries.length === 0
        && result.events.length === 8 && result.events.some(event => event.startsOn === '2027-02-01')
        : kind === 'exam' ? result.entries.length === 3 && (result.entries[0] as {date:string}).date === '2026-11-05'
        : result.documentType === 'class_timetable' && result.entries.some(entry => {const row=entry as {courseCode:string;dayOfWeek:number;startsAt:string;endsAt:string};return row.courseCode.replace(/\s/g,'') === 'MAT101' && row.dayOfWeek===1 && row.startsAt==='08:00' && row.endsAt==='09:00';});
      return { name, outcome: valid ? 'extraction_succeeded' : 'extraction_unusable', provider:generated.provider, classes: result.entries.length,
        events: result.events.length, elapsedMs: Date.now() - start,
        ...(name.startsWith('faculty')&&!valid?{mismatches:expectedFaculty.filter(expected=>!actualFaculty.some(actual=>JSON.stringify(actual)===JSON.stringify(expected))),actual:actualFaculty,diagnostic:{reads}}: {}) };
    } catch (error) {
      let diagnostic: Record<string,unknown>|undefined;
      try{const value=JSON.parse(generatedText);diagnostic={documentType:value.documentType,coverage:value.coverage,warnings:value.warnings,grid:value.grid};}catch{diagnostic={jsonReadable:false};}
      return { name, outcome: 'extraction_failed', elapsedMs: Date.now() - start,
        ...((diagnostic||providerFailures.length)?{diagnostic:{...diagnostic,providers:providerFailures,reads,...(fixtures.case==='baseline'?{alternative:await checkAlternative()}:{})}}:{}),
        ...((error as {reason?:string}).reason?.match(/^AI_[A-Z_]+$/) ? {reason:(error as {reason:string}).reason} : {}) };
    }
  };
  const baselineSelected=!fixtures.case||fixtures.case==='baseline';
  const calendar = baselineSelected?await readPrivateAIPdf(env,Uint8Array.from(atob(fixtures.calendarPdf), c => c.charCodeAt(0))):'';
  const exams = decodeAIText(new TextEncoder().encode('EXAM TIMETABLE 2026.\nMAT 101 Mathematics; 2026-11-05; 09:00-11:00; Main hall.\nCSC 101 Computing; 2026-11-06; 12:00-14:00; LT 1.\nPHY 101 Physics; 2026-11-09; 09:00-11:00; LT 2.'));
  const baseline=baselineSelected?Promise.all([
    checked('classImage', 'class', '', {mimeType:'image/png',data:fixtures.printedImage}),
    checked('handwrittenClass', 'class', 'Student notes: This handwritten class is on Monday. The written hours are 08:00 to 09:00.', {mimeType:'image/png',data:fixtures.handwriting}),
    checked('calendarPdf', 'calendar', calendar, undefined, true),
    checked('examText', 'exam', exams, undefined, true),
  ]):Promise.resolve([]);
  const faculty=[];
  if(fixtures.facultyImage) {
    if(!fixtures.case||fixtures.case==='facultyGrid200')faculty.push(await checked('facultyGrid200','class','',{mimeType:'image/jpeg',data:fixtures.facultyImage},true,{level:'200',department:'Computer Engineering'}));
    if(!fixtures.case||fixtures.case==='facultyGrid100')faculty.push(await checked('facultyGrid100','class',"I'm in 100lvl",{mimeType:'image/jpeg',data:fixtures.facultyImage},true,{level:'100'}));
  }
  if(fixtures.facultyWebp&&(!fixtures.case||fixtures.case==='facultyWebp100'))faculty.push(await checked('facultyWebp100','class',"I'm in 100lvl",{mimeType:'image/webp',data:fixtures.facultyWebp},true,{level:'100'}));
  if(fixtures.facultyPhoto&&(!fixtures.case||fixtures.case==='facultyPhoto100'))faculty.push(await checked('facultyPhoto100','class',"I'm in 100lvl",{mimeType:'image/jpeg',data:fixtures.facultyPhoto},true,{level:'100'}));
  return [...await baseline,...faculty];
}
