import {draftFormatError,draftIdentifier,draftRecord,draftString} from './draft-fields';
import type {CalendarFields} from './calendar-recovery';
export type CalendarCreateIntent={requestId:string;original:CalendarFields};
export type CalendarEditorDraft={target:string;requestId:string;fields:CalendarFields;base?:CalendarFields;create?:CalendarCreateIntent};
export function calendarDraftFields(value:unknown):CalendarFields {
  const row=draftRecord(value);
  return{title:draftString(row,'title','',160),startsOn:draftString(row,'startsOn','',10),endsOn:draftString(row,'endsOn','',10),semester:draftString(row,'semester','',80)};
}
export function restoreCalendarEditor(value:unknown):CalendarEditorDraft {
  const row=draftRecord(value),target=draftString(row,'target','',160),requestId=draftIdentifier(row,'requestId');
  if(!requestId||!(/^(?:new|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|local:[a-z0-9_-]{1,128})$/i.test(target)))throw draftFormatError();
  const base=row.base===undefined?undefined:calendarDraftFields(row.base);
  let create:CalendarCreateIntent|undefined;
  if(row.create!==undefined){const intent=draftRecord(row.create),key=draftIdentifier(intent,'requestId');if(!key||key!==requestId)throw draftFormatError();create={requestId:key,original:calendarDraftFields(intent.original)};}
  return{target,requestId,fields:calendarDraftFields(row.fields),...(base?{base}:{}),...(create?{create}:{})};
}
