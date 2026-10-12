import {api,ApiError} from './api';
import type {CalendarEditorDraft} from './calendar-editor';
import {calendarFields,sameCalendarFields,type CalendarDate,type CalendarFields} from './calendar-recovery';

export class CalendarConflict extends Error {
  constructor(readonly event:CalendarDate|null) {
    super(event?'This date changed online. Your edits are kept. Choose which version to use.':'This date was removed or is no longer available in your campus. Your edits are kept.');
  }
}
/** Resolve an uncertain create before editing it. No automatic background writes. */
export async function saveCalendarEditor(editor:CalendarEditorDraft,fields:CalendarFields,active:()=>boolean,overwrite?:CalendarDate,firstCreate=false):Promise<CalendarDate> {
  const ensureActive=()=>{if(!active())throw new Error('Your calendar session changed. Reopen the date before saving.');};
  const read=async(path:string)=>{const result=await api<{event:CalendarDate}>(path,{cache:'no-store',timeoutMs:12000});ensureActive();return result.event;};
  try {
    let online:CalendarDate,base=editor.base;
    if(overwrite){online=overwrite;base=calendarFields(overwrite);}
    else if(editor.create){
      const receipt=firstCreate?{state:'missing',event:null}:await api<{state:'missing'|'saved'|'unavailable';event:CalendarDate|null}>(`/v1/calendar/requests/${editor.create.requestId}`,{cache:'no-store',timeoutMs:12000});ensureActive();
      if(receipt.state==='unavailable')throw new CalendarConflict(null);
      if(receipt.state==='saved'&&receipt.event)online=receipt.event;
      else if(receipt.state==='missing'){
        const result=await api<{event:CalendarDate}>('/v1/calendar',{method:'POST',timeoutMs:12000,body:JSON.stringify({requestId:editor.create.requestId,event:editor.create.original})});ensureActive();online=result.event;
      }else throw new Error('Your calendar save receipt could not be read. Your edits are kept. Try again.');
      base=editor.create.original;
    }else if(editor.target==='new'||editor.target.startsWith('local:'))throw new Error('Keep this date open and try saving again.');
    else online=await read(`/v1/calendar/dates/${editor.target}`);
    const current=calendarFields(online);
    if(sameCalendarFields(fields,current))return online;
    if(!base||!sameCalendarFields(base,current))throw new CalendarConflict(online);
    ensureActive();
    const result=await api<{event:CalendarDate}>(`/v1/calendar/${online.id}`,{method:'PATCH',timeoutMs:12000,body:JSON.stringify({event:fields,expectedEvent:current})});ensureActive();return result.event;
  }catch(error){
    if(error instanceof ApiError){
      if(error.details?.kind==='calendar-request-unavailable'||error.details?.kind==='calendar-date-unavailable')throw new CalendarConflict(null);
      if(error.status===404)throw new Error('Calendar recovery is currently unavailable. Your draft is kept. Refresh and try again.');
      if(error.details?.kind==='calendar-date-changed'){
        const event=error.details.event as CalendarDate|undefined;
        if(event&&typeof event.id==='string'&&typeof event.title==='string')throw new CalendarConflict(event);
      }
    }
    throw error;
  }
}
