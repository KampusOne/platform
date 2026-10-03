"use client";
import { useEffect, useState } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import { DonutBreakdown, HorizontalBars } from "./analytics-visuals";
import { DailyActivity } from "./daily-activity";
import styles from "./admin-reporting.module.css";

type Module = "users" | "agents" | "content" | "marketplace" | "messages" | "campaigns";
type Report = { ready: false; message: string } | { ready: true; categories: {label:string;value:number}[]; daily: Record<string,string|number|null>[]; definition:string };
const labels: Record<Module,string> = { users: "Account activity", agents: "Application activity", content: "Publishing activity", marketplace: "Product activity", messages: "Message activity", campaigns: "Campaign delivery" };
export function WorkspaceInsights({ module, refresh = 0 }: { module: Module; refresh?:number }) {
  const { scopedPath, can } = useAdminContext();
  const [retry,setRetry] = useState(0),[loaded,setLoaded] = useState<{key:string;data?:Report;error?:string}>();
  const path=scopedPath(`/v1/admin/reports/workspace?module=${module}`), key=`${path}:${refresh}:${retry}`;
  useEffect(()=>{if(!can("analytics.view"))return;const controller=new AbortController();void portalApi<Report>(path,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setLoaded({key,data});}).catch(error=>{if(!controller.signal.aborted)setLoaded({key,error:error instanceof Error?error.message:"Workspace insight unavailable."});});return()=>controller.abort();},[path,key,can]);
  if(!can("analytics.view"))return null;
  const value=loaded?.key===key?loaded:undefined;
  return <section className={styles.section} aria-label={labels[module]}><div className={styles.header}><div><p className="section-kicker">Last 30 days · West Africa Time</p><h2>{labels[module]}</h2></div></div>{!value?<div className="table-skeleton" aria-label="Loading workspace insights" aria-busy="true"><div/><div/></div>:value.error?<div className="state-panel state-panel--error" role="alert"><p>{value.error}</p><button className="button button--secondary" onClick={()=>setRetry(n=>n+1)}>Retry insights</button></div>:value.data?.ready===false?<p className="state-panel">{value.data.message}</p>:value.data?.ready?<><div className={styles.charts}><DonutBreakdown title={module==="campaigns"?"Recipient delivery states":"Record categories"} rows={value.data.categories}/><HorizontalBars title={module==="messages"?"Messages by format":"Recorded totals"} rows={value.data.categories}/></div>{!value.data.categories.length&&<p className="state-panel">No records in the last 30 days.</p>}{value.data.categories.length>0&&<DailyActivity rows={value.data.daily} title={`${labels[module]} by day`} metricKey="events" metricLabel="records" description={value.data.definition}/>}</>:null}</section>;
}
