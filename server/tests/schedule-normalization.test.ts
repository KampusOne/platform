import {describe,it,expect} from 'vitest';
import {normalizeScheduleEntry} from '../src/lib/schedule-document';
import {timetableEntrySchema} from '@kampusone/contracts';
describe('readable timetable normalization',()=>{
 it('accepts actual AM/PM and day labels from image extraction',()=>{const item=normalizeScheduleEntry({title:'Math',dayOfWeek:'Monday',startsAt:'8:15 AM',endsAt:'10:00 AM',courseCode:null});expect(timetableEntrySchema.parse(item)).toMatchObject({dayOfWeek:1,startsAt:'08:15',endsAt:'10:00',courseCode:''});});
 it('does not invent missing or impossible times',()=>{expect(timetableEntrySchema.safeParse(normalizeScheduleEntry({title:'Math',dayOfWeek:'Tuesday',startsAt:'25:00',endsAt:null})).success).toBe(false);});
});
