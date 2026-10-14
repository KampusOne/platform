import {privateTimetableImage} from '@/lib/private-timetable-image';
export const maxDuration=20;
export const dynamic='force-dynamic';
export async function POST(request:Request) {return privateTimetableImage(request);}
