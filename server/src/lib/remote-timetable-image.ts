import type {AIEnvironment,AIMedia} from './ai-provider';
import {AIProviderError} from './ai-error';
import {imageProcessingToken} from './image-processing-auth';
import type {TimetableImageRow,TimetableLayoutImage} from './timetable-image-grid';

export const imageProcessorURL='https://agents.kampusone.app/internal-processing/timetable-image';
async function imageOperation(env:AIEnvironment,body:Record<string,unknown>,deadline?:number) {
  if(env.TIMETABLE_IMAGE_PROCESSOR_URL!==imageProcessorURL||!env.JWT_SECRET)throw new AIProviderError(503,'AI_NOT_CONFIGURED','The image reader is not ready. Your full file is kept; no import credit was used.');
  const encoded=JSON.stringify(body);
  // Larger originals still use the existing original-image focused fallback.
  if(encoded.length>4_200_000)return {};
  const remaining=Math.min(15000,(deadline??Infinity)-Date.now());
  if(remaining<1)throw new AIProviderError(504,'AI_TIMEOUT','Reading took too long. Your full file is kept; no import credit was used.');
  try {
    const response=await fetch(imageProcessorURL,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(remaining),headers:{'Content-Type':'application/json',Authorization:'Bearer '+await imageProcessingToken(env.JWT_SECRET,encoded)},body:encoded});
    if(!response.ok)throw new Error('Image service unavailable');
    if(Number(response.headers.get('content-length')??0)>4_200_000)throw new Error('Invalid image service response');
    const text=await response.text();if(text.length>4_200_000)throw new Error('Invalid image service response');
    const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid image service response');
    return value as {layout?:TimetableLayoutImage;rows?:TimetableImageRow[]};
  } catch {
    throw new AIProviderError(503,'AI_PROVIDER_BUSY','The image reader is temporarily unavailable. Your full file is kept; no import credit was used.');
  }
}
const mediaValid=(value:AIMedia)=>value?.mimeType==='image/png'&&typeof value.data==='string'&&value.data.length>0&&value.data.length<4_200_000&&/^[A-Za-z0-9+/]*={0,2}$/.test(value.data);
export async function remoteTimetableLayout(env:AIEnvironment,media:AIMedia,deadline?:number) {
  const {layout}=await imageOperation(env,{operation:'layout',media},deadline);
  if(layout&&(!mediaValid(layout)||!Number.isInteger(layout.timeColumnCount)||layout.timeColumnCount<1||layout.timeColumnCount>24||!Number.isInteger(layout.levelRowCount)||layout.levelRowCount<1||layout.levelRowCount>140))throw new AIProviderError(502,'AI_INCOMPLETE_SCHEDULE','The image layout could not be verified. Your full file is kept; no import credit was used.');
  return layout;
}
export async function remoteTimetableRows(env:AIEnvironment,media:AIMedia,timeColumnCount:number,levels:string[],days:number[],selectedLevel:string,deadline?:number) {
  const {rows}=await imageOperation(env,{operation:'rows',media,timeColumnCount,levels,days,selectedLevel},deadline);
  if(rows&&(!Array.isArray(rows)||rows.length!==days.length||rows.some((row,i)=>row.day!==days[i]||!mediaValid(row.media)||!Array.isArray(row.cells)||row.cells.length<1||row.cells.length>24||row.cells.some((cell,j)=>!Number.isInteger(cell.from)||!Number.isInteger(cell.to)||cell.from!==(j?row.cells[j-1]!.to:0)||cell.to<=cell.from||cell.to>timeColumnCount)||row.cells.at(-1)?.to!==timeColumnCount)))throw new AIProviderError(502,'AI_INCOMPLETE_SCHEDULE','The image cells could not be verified. Your full file is kept; no import credit was used.');
  return rows;
}
