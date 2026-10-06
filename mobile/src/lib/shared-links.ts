import { APP_ORIGIN } from "./app-links";
export const shareKinds = [
  "post",
  "profile",
  "business",
  "product",
  "tutorial",
  "material",
  "community",
  "study-group",
  "class-community",
  "message",
  "ai",
  "streak",
  "exam-period",
] as const;
export type ShareKind = (typeof shareKinds)[number];
const configured =
  process.env.EXPO_PUBLIC_SHARE_ORIGIN || "https://links.kampusone.app";
const origin = new URL(configured);
if (
  origin.protocol !== "https:" ||
  !["links.kampusone.app", "kampusone.app"].includes(origin.hostname) ||
  origin.username ||
  origin.password ||
  origin.port ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw new Error("Configure a verified KampusOne share origin.");
export const SHARE_ORIGIN = origin.origin;
export function validSharedId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
export function sharedLink(kind: ShareKind, id: string) {
  if (!shareKinds.includes(kind) || !sharedDestination(kind,id))
    throw new Error("This content link is not valid.");
  return `${SHARE_ORIGIN}/s/${kind}/${id}`;
}
export function sharedDestination(
  kind: unknown,
  id: unknown,
): {
  pathname:
    | "/post"
    | "/student-profile"
    | "/student-service"
    | "/(tabs)/store"
    | "/(tabs)/tutorials"
    | "/learning-preview"
    | "/community"
    | "/shared-message"
    | "/ai"
    | "/streak"
    | "/exam-countdown";
  params: Record<string, string>;
} | null {
  if (kind==='ai'&&id==='kira')return {pathname:'/ai',params:{}};
  if (kind==='streak'&&id==='today')return {pathname:'/streak',params:{}};
  if(kind==='exam-period'&&typeof id==='string'){
    const dates=id.split('_');
    if(dates.length===2&&validPeriodDates(dates[0]!,dates[1]!))return {pathname:'/exam-countdown',params:{startsOn:dates[0]!,endsOn:dates[1]!}};
    return null;
  }
  if (!validSharedId(id)) return null;
  if(kind==='community'||kind==='study-group'||kind==='class-community')return {pathname:'/community',params:{id,...(kind==='class-community'?{}:{kind:kind==='study-group'?'STUDY_GROUP':'COMMUNITY'})}};
  if(kind==='message')return {pathname:'/shared-message',params:{id}};
  if (kind === "post") return { pathname: "/post", params: { id } };
  if (kind === "profile")
    return { pathname: "/student-profile", params: { id } };
  if (kind === "business")
    return { pathname: "/student-service", params: { id } };
  if (kind === "product")
    return { pathname: "/(tabs)/store", params: { product: id } };
  if (kind === "tutorial")
    return { pathname: "/(tabs)/tutorials", params: { listing: id } };
  if (kind === "material")
    return { pathname: "/learning-preview", params: { id } };
  return null;
}
export function approvedSharedUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.protocol !== "https:" ||
      ![APP_ORIGIN, SHARE_ORIGIN].includes(url.origin)
    )
      return false;
    if (url.pathname === "/" && !url.search) return true;
    const match = /^\/s\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    return !!match && !url.search && !!sharedDestination(match[1], match[2]);
  } catch {
    return false;
  }
}

export function validPeriodDates(start:string,end:string){
 const real=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
 return real(start)&&real(end)&&end>=start&&Date.parse(end)-Date.parse(start)<=366*86400000;
}
export function sharedExamPeriodLink(start:string,end:string){return sharedLink('exam-period',start+'_'+end);}
