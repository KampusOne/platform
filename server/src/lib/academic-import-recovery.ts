import { generateAI, type AIEnvironment, type AIInput } from './ai-provider';
import { parseAcademicImport } from './academic-import';
import { AIProviderError } from './ai-error';
import { incompleteSchedule, levelKey, readScheduleJSON, scheduleCoverage, type TimetableScope } from './timetable-extraction';

const dayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export async function generateAcademicImport(env:AIEnvironment,input:AIInput,sourceText:string,
  kind?:'class'|'calendar'|'exam',scope:TimetableScope={}) {
  const initial=input.media&&scope.level&&kind!=='calendar'&&kind!=='exam'?{...input,
    prompt:'FIRST READ ONLY THE LAYOUT. If this image is a timetable grid, return its documentType, all printed timeSlots in left-to-right 24-hour order, the printed levels and daysSeen. Set grid.rows:[], entries:[], events:[] and coverage:{complete:false,daysRead:[],rowCount:0,uncertain:[]}. Do not transcribe any courses yet. The next internal step reads each selected row. If this is a simple list instead of a grid, return the complete normal schedule with entries/events and coverage.\nStudent source context:\n'+input.prompt,
    systemContext:(input.systemContext??'')+'\nThis is an internal layout read. A grid layout is intentionally not a finished schedule and will never be shown or saved as one. Read the time-column headers, weekdays and level labels only. The application assembles every selected weekday row before import.',
  }:input;
  const generated=await generateAI(env,initial);
  input.onScheduleRead?.(null,generated.text);
  return {...generated,extracted:await parseOrRecoverAcademicImport(env,input,generated.text,sourceText,kind,scope)};
}

/** A dense grid is one user import even when the provider needs focused reads.
 * Never expose a subset: all day rows must finish within the original deadline,
 * agree on their printed time headers, and pass the same full-grid validator. */
export async function parseOrRecoverAcademicImport(env: AIEnvironment, input: AIInput, text: string, sourceText: string,
  kind?: 'class'|'calendar'|'exam', scope:TimetableScope={}) {
  let parsed:ReturnType<typeof parseAcademicImport>|undefined, failure:unknown;
  try { parsed=parseAcademicImport(text,sourceText,kind,{strict:true,scope}); }
  catch(error) {failure=error;}
  // Multi-level images always receive focused row verification, even when a
  // whole-image answer claims completeness but assigns plausible wrong clocks.
  let value:Record<string,unknown>;
  try {value=readScheduleJSON(text);}catch{if(parsed)return parsed;throw failure;}
  const grid=value.grid as {daysSeen?:unknown;levels?:unknown}|undefined;
  const dense=input.media&&scope.level&&Array.isArray(grid?.levels)&&grid.levels.length>1;
  if(parsed&&!dense)return parsed;
  {
    if ((failure&&(!(failure instanceof AIProviderError) || failure.reason!=='AI_INCOMPLETE_SCHEDULE'))
      || kind==='calendar' || kind==='exam' || !input.media || !scope.level
      || !input.deadline || input.deadline-Date.now()<20000) throw failure??incompleteSchedule();
    const days=grid?.daysSeen;
    if(value.documentType!=='class_timetable'||!Array.isArray(days)||!days.length||days.length>7
      ||days.some(day=>typeof day!=='number'||!Number.isInteger(day)||day<0||day>6)||new Set(days).size!==days.length) throw failure??incompleteSchedule();
    if(!Array.isArray(grid?.levels)||grid.levels.some(level=>typeof level!=='string'))throw incompleteSchedule();
    if(grid.levels.length&&!grid.levels.some(level=>levelKey(level)===scope.level))
      throw new AIProviderError(422,'AI_LEVEL_NOT_FOUND','The selected level is not on this timetable. Check your level. No import credit was used.');
    const printedLevel=grid.levels.length?scope.level:'';
    const ordered=(days as number[]).slice().sort((a,b)=>a-b);
    if(grid.levels.length>1) {
      // One stronger vision pass for the hard multi-level case, within this
      // same request, credit reservation and deadline. No reasoning or tools.
      try {
        const precise=await generateAI(env,{...input,schedulePrecision:true,
          prompt:`Extract ONLY the rows explicitly labelled ${printedLevel} level across ALL printed weekdays in this image. Do not include other levels. Return the complete grid with ordered 24-hour timeSlots and exactly one selected-level row per printed day. Read the physical cell borders: merged cells span every time column they cover, and blank columns stay blank. Preserve every course/laboratory label. entries and events must be empty because the application derives class times from the grid. coverage.rowCount is the number of weekday rows, not the number of classes.`,
        });
        input.onScheduleRead?.(null,precise.text);
        const preciseValue=readScheduleJSON(precise.text),preciseGrid=preciseValue.grid as {daysSeen?:unknown}|undefined;
        const preciseDays=preciseGrid?.daysSeen;
        if(!Array.isArray(preciseDays)||preciseDays.length!==ordered.length||ordered.some(day=>!preciseDays.includes(day)))throw incompleteSchedule();
        return parseAcademicImport(precise.text,sourceText,kind,{strict:true,scope});
      }catch(error){
        if(input.deadline!-Date.now()<20000)throw error;
      }
    }
    const parts=await Promise.all(ordered.map(async day=>{
      const result=await generateAI(env,{...input,
        prompt:`Read ONLY the ${dayNames[day]} row ${printedLevel?'labelled '+printedLevel+' level':'of this single-level timetable'} in this image. Ignore every other day and level. Copy the printed time headers and the exact horizontal cell boundaries. Do not count DAYS or LEVEL as time columns: column 0 is the first printed time column. A label spanning several time columns is one merged cell; follow its left and right grid borders. Include the blank columns. Return a grid with exactly ONE row, dayOfWeek:${day}, level:${JSON.stringify(printedLevel)}. Do not put any other row in this response.`,
        systemContext:(input.systemContext??'')+`\nThis is one internal day read. For THIS response use grid.daysSeen:[${day}], coverage.daysRead:[${day}], coverage.rowCount:1 and grid.rows containing exactly the requested row. The application assembles every printed day into one complete import. Do not extract other levels or copy their courses. Do not filter the selected row's cells by course codes.`,
      });
      input.onScheduleRead?.(day,result.text);
      const part=readScheduleJSON(result.text), coverage=scheduleCoverage(part);
      const g=part.grid as {timeSlots?:unknown;levels?:unknown;daysSeen?:unknown;rows?:unknown}|undefined;
      const rows=g?.rows;
      if(part.documentType!=='class_timetable'||!g||!Array.isArray(rows)||rows.length!==1
        ||!rows[0]||rows[0].dayOfWeek!==day||String(rows[0].level)!==printedLevel
        ||coverage.daysRead.length!==1||coverage.daysRead[0]!==day) throw incompleteSchedule();
      return {grid:g,row:rows[0]};
    }));
    const headers=JSON.stringify(parts[0]!.grid.timeSlots);
    if(parts.some(part=>JSON.stringify(part.grid.timeSlots)!==headers)) throw incompleteSchedule('The day reads disagreed on the printed time columns. Your full file is kept; no import credit was used.');
    const combined={documentType:'class_timetable',entries:[],events:[],warnings:[],
      coverage:{complete:true,daysRead:ordered,rowCount:parts.length,uncertain:[]},
      grid:{timeSlots:parts[0]!.grid.timeSlots,levels:printedLevel?[printedLevel]:[],daysSeen:ordered,rows:parts.map(part=>part.row)},
    };
    return parseAcademicImport(JSON.stringify(combined),sourceText,kind,{strict:true,scope});
  }
}
