export type ExamPeriod = { semester:string; startsOn:string; endsOn:string; status:"upcoming"|"ongoing"|"completed" };
export function examPeriodStart(period: ExamPeriod) { return Date.parse(period.startsOn + "T00:00:00+01:00"); }
export function examPeriodEnd(period: ExamPeriod) { return Date.parse(period.endsOn + "T23:59:59+01:00"); }
export function countdownParts(target: number, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((target-now)/1000));
  return { days:Math.floor(seconds/86400),hours:Math.floor(seconds%86400/3600),minutes:Math.floor(seconds%3600/60),seconds:seconds%60 };
}
export function currentExamPeriod(periods: ExamPeriod[], now = Date.now()) {
  return periods.find(p=>examPeriodStart(p)<=now&&examPeriodEnd(p)>=now) ?? periods.find(p=>examPeriodStart(p)>now) ?? null;
}
export function formatExamDate(value:string) { return new Date(value+"T12:00:00+01:00").toLocaleDateString("en-NG",{day:"numeric",month:"short",year:"numeric",timeZone:"Africa/Lagos"}); }
