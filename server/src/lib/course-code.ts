/** A grade belongs to one course. Never assign ambiguous shared units to several codes. */
export function isSingleCourseCode(value:string){
 const code=value.trim();
 if(code.length<2||code.length>24||/[,;/\r\n&+]/.test(code))return false;
 return (code.match(/[A-Za-z]{2,8}[ \t_-]*\d{2,4}[A-Za-z]?/g)?.length??0)<=1;
}
export function courseCodeIdentity(value:string){return value.trim().toUpperCase().replace(/[ \t_-]+/g,'');}
