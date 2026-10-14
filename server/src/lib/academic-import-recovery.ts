import { generateAI, type AIEnvironment, type AIInput } from './ai-provider';
import { parseAcademicImport } from './academic-import';
import { AIProviderError } from './ai-error';
import { incompleteSchedule, levelKey, readScheduleJSON, scheduleCoverage, type TimetableScope } from './timetable-extraction';
import { timetableImageRows, timetableLayoutImage, type TimetableLayoutImage } from './timetable-image-grid';
import { prepareTimetableImage } from './webp-pixels';
import {remoteTimetableLayout,remoteTimetableRows} from './remote-timetable-image';

const dayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const printedDays:Record<string,number>={sun:0,sunday:0,mon:1,monday:1,tue:2,tues:2,tuesday:2,wed:3,wednesday:3,thu:4,thur:4,thurs:4,thursday:4,fri:5,friday:5,sat:6,saturday:6};
const printedDay=(value:unknown)=>typeof value==='string'?printedDays[value.trim().replace(/\.$/,'').toLowerCase()]:value;

export async function generateAcademicImport(env:AIEnvironment,input:AIInput,sourceText:string,
  kind?:'class'|'calendar'|'exam',scope:TimetableScope={}) {
  if(input.media&&!env.TIMETABLE_IMAGE_PROCESSOR_URL&&kind!=='calendar'&&kind!=='exam')input={...input,media:await prepareTimetableImage(input.media)};
  const needsLayout=Boolean(input.media&&scope.level&&kind!=='calendar'&&kind!=='exam');
  const layout=needsLayout?(env.TIMETABLE_IMAGE_PROCESSOR_URL?await remoteTimetableLayout(env,input.media!,input.deadline):timetableLayoutImage(input.media!)):undefined;
  const initial=needsLayout?{...input,scheduleLayout:true,...(layout?{media:layout}:{}),
    prompt:'FIRST READ ONLY THE LAYOUT. If this image is a timetable grid, return its documentType, all printed timeSlots in left-to-right 24-hour order, the printed levels in their TOP-TO-BOTTOM row order within each day, and daysSeen in their TOP-TO-BOTTOM printed order as numbers (Sunday=0, Monday=1, Tuesday=2, Wednesday=3, Thursday=4, Friday=5, Saturday=6). Set grid.rows:[], entries:[], events:[] and coverage:{complete:false,daysRead:[],rowCount:0,uncertain:[]}. Do not transcribe any courses yet. The next internal step reads each selected row. If this is a simple list instead of a grid, return the complete normal schedule with entries/events and coverage.\nStudent source context:\n'+input.prompt,
    systemContext:(input.systemContext??'')+'\nThis is an internal layout read. A grid layout is intentionally not a finished schedule and will never be shown or saved as one. Read the time-column headers, weekdays and level labels only. The application assembles every selected weekday row before import.'+(layout?' The numbered contact sheet contains time headings in panels 0 then 1, followed by all day/level labels in panel order, left to right then top to bottom. Panel numbers are not source text. Copy the first day\'s level labels in their printed order and every distinct weekday. No course transcription is needed.':''),
  }:input;
  const read=()=>generateAI(env,needsLayout?{...initial,deadline:Math.min(input.deadline??Infinity,Date.now()+35000)}:initial);
  let generated:Awaited<ReturnType<typeof generateAI>>;
  try{generated=await read();}catch(error){
    if(!needsLayout||!(error instanceof AIProviderError)||error.status<500||(input.deadline??0)-Date.now()<60000)throw error;
    generated=await read();
  }
  if(layout&&!matchesPixelInventory(generated.text,layout)) {
    generated=await generateAI(env,{...initial,deadline:Math.min(input.deadline??Infinity,Date.now()+35000),
      prompt:initial.prompt+`\nThe application verified ${layout.timeColumnCount} printed time columns and ${layout.levelRowCount} individual level rows from the pixels. Your inventory must account for all of them. The whole day/level strip is in panel 2. Read it top to bottom, including every weekday. Do not combine or skip time columns or level labels.`,
    });
  }
  input.onScheduleRead?.(null,generated.text);
  return {...generated,extracted:await parseOrRecoverAcademicImport(env,input,generated.text,sourceText,kind,scope,layout)};
}

function matchesPixelInventory(text:string,layout:TimetableLayoutImage) {
  try {
    const value=readScheduleJSON(text),grid=value.grid as {timeSlots?:unknown;levels?:unknown;daysSeen?:unknown}|undefined;
    return Array.isArray(grid?.timeSlots)&&grid.timeSlots.length===layout.timeColumnCount
      &&Array.isArray(grid.levels)&&Array.isArray(grid.daysSeen)&&grid.levels.length*grid.daysSeen.length===layout.levelRowCount;
  } catch {return false;}
}

/** A dense grid is one user import even when the provider needs focused reads.
 * Never expose a subset: all day rows must finish within the original deadline,
 * agree on their printed time headers, and pass the same full-grid validator. */
export async function parseOrRecoverAcademicImport(env: AIEnvironment, input: AIInput, text: string, sourceText: string,
  kind?: 'class'|'calendar'|'exam', scope:TimetableScope={}, verifiedLayout?:TimetableLayoutImage) {
  let parsed:ReturnType<typeof parseAcademicImport>|undefined, failure:unknown;
  try { parsed=parseAcademicImport(text,sourceText,kind,{strict:true,scope}); }
  catch(error) {failure=error;}
  // Multi-level images always receive focused row verification, even when a
  // whole-image answer claims completeness but assigns plausible wrong clocks.
  let value:Record<string,unknown>;
  try {value=readScheduleJSON(text);}catch{if(parsed)return parsed;throw failure;}
  const grid=value.grid as {daysSeen?:unknown;levels?:unknown;timeSlots?:unknown}|undefined;
  const pixelLayout=verifiedLayout??(!env.TIMETABLE_IMAGE_PROCESSOR_URL&&input.media&&scope.level&&kind!=='calendar'&&kind!=='exam'?timetableLayoutImage(input.media):undefined);
  if(pixelLayout&&!matchesPixelInventory(text,pixelLayout))throw incompleteSchedule('The time columns or weekday rows were missed while reading. Your full file is kept; no import credit was used.');
  const dense=input.media&&scope.level&&Array.isArray(grid?.levels)&&grid.levels.length>1;
  if(parsed&&!dense)return parsed;
  {
    if ((failure&&(!(failure instanceof AIProviderError) || failure.reason!=='AI_INCOMPLETE_SCHEDULE'))
      || kind==='calendar' || kind==='exam' || !input.media || !scope.level
      || !input.deadline || input.deadline-Date.now()<20000) throw failure??incompleteSchedule();
    const days=Array.isArray(grid?.daysSeen)?grid.daysSeen.map(printedDay):grid?.daysSeen;
    if(value.documentType!=='class_timetable'||!Array.isArray(days)||!days.length||days.length>7
      ||days.some(day=>typeof day!=='number'||!Number.isInteger(day)||day<0||day>6)||new Set(days).size!==days.length) throw failure??incompleteSchedule();
    if(!Array.isArray(grid?.levels)||grid.levels.some(level=>typeof level!=='string'))throw incompleteSchedule();
    if(grid.levels.length&&!grid.levels.some(level=>levelKey(level)===scope.level))
      throw new AIProviderError(422,'AI_LEVEL_NOT_FOUND','The selected level is not on this timetable. Check your level. No import credit was used.');
    const printedLevel=grid.levels.length?scope.level:'';
    const ordered=(days as number[]).slice().sort((a,b)=>a-b);
    if(grid.levels.length>1) {
      if(!Array.isArray(grid.timeSlots))throw incompleteSchedule();
      const crops=env.TIMETABLE_IMAGE_PROCESSOR_URL?await remoteTimetableRows(env,input.media,grid.timeSlots.length,grid.levels.map(levelKey),days as number[],printedLevel,input.deadline):timetableImageRows(input.media,grid.timeSlots.length,grid.levels.map(levelKey),days as number[],printedLevel);
      if(crops) {
        const rows=await Promise.all(crops.map(async crop=>{
          const keys=Array.from({length:crop.cells.length+1},(_,i)=>String(i));
          const schema={labels:Object.fromEntries(keys.map(key=>[key,key==='0'?'printed level':`panel ${key} text`])),coverage:{complete:true,uncertain:[]}};
          const request={...input,media:crop.media,scheduleLayout:true,
            prompt:`Transcribe the numbered image panels, in order, for ${dayNames[crop.day]}. Panel 0 is the printed LEVEL label. Panels 1 through ${crop.cells.length} are the actual cells from that row. Return ONLY JSON in this exact shape: ${JSON.stringify(schema)}. Match each label to its visible panel number. The labels object must have exactly these keys: ${keys.join(', ')}. Use "" for a visibly blank numbered panel. Copy the exact course codes, slash-separated alternatives, laboratories and parentheses. A line break inside one panel stays in one label. Do not infer time, level, courses or missing text. If a panel is illegible mark coverage.complete:false.`,
            systemContext:'This is an internal transcription of isolated timetable cells. Return the requested labels JSON, not schedule entries, events or a grid. Panel numbers are application labels and are not part of the source text. Never combine panels or add courses from outside the supplied pixels. Preserve blank panels.',
          };
          for(let attempt=0;attempt<2;attempt++) {
            const result=await generateAI(env,attempt===0?request:{...request,
              deadline:Math.min(input.deadline!,Date.now()+35000),
              prompt:request.prompt+'\nThe previous response did not match the numbered panels. Read the same image again. Return one value for each visible panel number, including every blank. Do not insert any extra panel or shift a label to a different number.',
            });
            input.onScheduleRead?.(crop.day,result.text);
            const part=readScheduleJSON(result.text),coverage=part.coverage as {complete?:unknown;uncertain?:unknown}|undefined;
            if(coverage?.complete!==true||!Array.isArray(coverage.uncertain)||coverage.uncertain.length)throw incompleteSchedule();
            const labels=part.labels as Record<string,unknown>|undefined;
            const indexed=labels&&typeof labels==='object'&&!Array.isArray(labels)&&Object.keys(labels).length===keys.length
              &&keys.every(key=>typeof labels[key]==='string'&&(labels[key] as string).length<=160);
            if(indexed) {
              if(levelKey(labels['0'])!==printedLevel)throw incompleteSchedule();
              return {dayOfWeek:crop.day,level:printedLevel,cells:crop.cells.map((cell,i)=>({...cell,label:labels[String(i+1)] as string}))};
            }
            // Retry a malformed panel inventory once, within this same import.
            // Uncertain pixels and mismatched levels never receive a guessed fix.
            if(attempt===1||input.deadline!-Date.now()<20000)throw incompleteSchedule();
          }
          throw incompleteSchedule();
        }));
        return parseAcademicImport(JSON.stringify({documentType:'class_timetable',entries:[],events:[],warnings:[],
          coverage:{complete:true,daysRead:ordered,rowCount:rows.length,uncertain:[]},
          grid:{timeSlots:grid.timeSlots,levels:[printedLevel],daysSeen:ordered,rows},
        }),sourceText,kind,{strict:true,scope});
      }
      // Photos, WebP, large originals and faint/skewed rules are valid uploads.
      // Pixel isolation is an optimization, not an admission requirement. Read
      // every requested day from the original and validate the assembled grid.
      console.info(JSON.stringify({event:'ai.timetable.original_row_read',reason:'pixel_geometry_unavailable'}));
    }
    const parts=await Promise.all(ordered.map(async day=>{
      const result=await generateAI(env,{...input,scheduleLayout:false,
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
