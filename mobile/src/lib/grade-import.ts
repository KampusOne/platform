export type PlannerGrade={course_code:string;title:string;units:string|number|null;grade:string|null};
export type ImportedGrade={courseCode:string;courseTitle:string;units:number;grade:string;gradePoint:number};
export function isSingleCourseCode(value:string){const code=value.trim();return code.length>=2&&code.length<=24&&!/[,;/\r\n&+]/.test(code)&&(code.match(/[A-Za-z]{2,8}[ \t_-]*\d{2,4}[A-Za-z]?/g)?.length??0)<=1;}
export function courseCodeIdentity(value:string){return value.trim().toUpperCase().replace(/[ \t_-]+/g,'');}
export function prepareGradePlannerImport(courses:PlannerGrade[],scale:Record<string,number>){
 const counts=new Map<string,number>();for(const course of courses){if(isSingleCourseCode(course.course_code)){const key=courseCodeIdentity(course.course_code);counts.set(key,(counts.get(key)??0)+1);}}
 const rows:ImportedGrade[]=[],warnings:string[]=[];
 for(const course of courses){const code=course.course_code.trim().toUpperCase(),grade=course.grade?.trim().toUpperCase()??'',units=Number(course.units);
  if(!isSingleCourseCode(code)){warnings.push(`${code||'An unnamed row'} contains more than one course code. Separate the courses in Grade Planner and confirm each course’s units.`);continue;}
  if((counts.get(courseCodeIdentity(code))??0)>1){const warning=`${code} appears more than once. Confirm its grade and units in Grade Planner before importing.`;if(!warnings.includes(warning))warnings.push(warning);continue;}
  if(!grade||!course.title.trim()||!Number.isFinite(units)||units<=0||units>30){warnings.push(`${code} needs a title, grade and valid course units before importing.`);continue;}
  const gradePoint=scale[grade];if(typeof gradePoint!=="number"||!Number.isFinite(gradePoint)||gradePoint<0||gradePoint>7){warnings.push(`${code}: grade ${grade} is missing from your university’s grading scale.`);continue;}
  rows.push({courseCode:code,courseTitle:course.title.trim(),units,grade,gradePoint});
 }
 return {rows,warnings};
}
