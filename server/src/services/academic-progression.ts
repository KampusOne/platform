import {sql} from 'drizzle-orm';
import {database,firstRow} from '../lib/database';
import type {Bindings} from '../types';
export async function academicCalendarReady(env:Bindings):Promise<boolean>{
 if(env?.UNIFIED_SCHEMA_READY!=='true')return false;
 return firstRow(await database(env).execute<{ready:boolean}>(sql`select to_regclass('public.shared_academic_calendars') is not null and to_regclass('public.student_level_transitions') is not null as ready`))?.ready===true;
}
export async function applyDueAcademicProgressions(env:Bindings){
 if(!await academicCalendarReady(env))return;
 await database(env).execute(sql`select app_private.apply_due_academic_progressions()`);
}
