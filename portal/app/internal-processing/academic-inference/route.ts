import {privateAcademicInference} from '../../../lib/private-academic-inference';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request:Request) {return privateAcademicInference(request);}
