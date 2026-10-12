export type CalendarFields={title:string;startsOn:string;endsOn:string;semester:string};
export type CalendarDate = {
    id: string;
    title: string;
    starts_on: string;
    ends_on: string;
    semester: string;
    requestId?: string;
    submittedEvent?:CalendarFields;
    pendingBase?:CalendarFields;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Only modern local records carry the submitted request ID; legacy local IDs were unrelated random IDs. */
export function calendarRetryId(event: CalendarDate | undefined) { return event?.requestId && uuid.test(event.requestId) ? event.requestId : null; }
export function calendarRecoveredRows(rows: CalendarDate[], saved: CalendarDate, editing: string) {
    const retained = rows.filter(row => row.id !== saved.id && row.id !== editing);
    return [...retained, saved];
}
export function calendarFields(event:CalendarDate):CalendarFields {
    return{title:event.title,startsOn:event.starts_on,endsOn:event.ends_on,semester:event.semester};
}
export function sameCalendarFields(left:CalendarFields,right:CalendarFields){
    return left.title.trim()===right.title.trim()&&left.startsOn===right.startsOn&&left.endsOn===right.endsOn&&left.semester.trim()===right.semester.trim();
}
