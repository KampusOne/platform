"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";

type Refund = { id:string;university_id:string;original_reference:string;resource_type:string;status:string;customer_refund_kobo:number;original_principal_kobo:number;original_collection_fee_kobo:number;review_reason:string|null;provider_refund_id:string|null;collection_fee_treatment:string;accounting_mode:string };
const money=(value:number)=>new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN"}).format(Number(value)/100);
function minor(value:string){
  if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw new Error("Enter a positive naira amount with up to two decimal places.");
  const [whole,fraction=""]=value.split("."),amount=Number(whole)*100+Number(fraction.padEnd(2,"0"));
  if(!Number.isSafeInteger(amount)||amount<=0||amount>2_000_000_000)throw new Error("Choose a refund amount within the supported range.");
  return amount;
}
export function FinanceRefunds(){const {scope}=useAdminContext();return <ScopedRefunds key={scope}/>;}
function ScopedRefunds(){
  const {scope,access,can,scopedPath}=useAdminContext(),[rows,setRows]=useState<Refund[]>([]),[loaded,setLoaded]=useState(false),[version,setVersion]=useState(0),[selected,setSelected]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const requestId=useRef<string|null>(null),alive=useRef(true),lock=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    const controller=new AbortController();
    void portalApi<{refunds:Refund[]}>(scopedPath("/v1/admin/finance/refunds"),{signal:controller.signal}).then(result=>{
      if(!Array.isArray(result.refunds)||result.refunds.some(r=>!r||![r.id,r.university_id,r.original_reference,r.resource_type,r.status,r.collection_fee_treatment,r.accounting_mode].every(v=>typeof v==="string")||![r.customer_refund_kobo,r.original_principal_kobo,r.original_collection_fee_kobo].every(v=>Number.isSafeInteger(Number(v))&&Number(v)>=0)||(r.review_reason!==null&&typeof r.review_reason!=="string")||(r.provider_refund_id!==null&&typeof r.provider_refund_id!=="string")))throw new Error("Refund records could not be read. Try again.");
      if(!controller.signal.aborted){setRows(result.refunds);setLoaded(true);setError("");}
    }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Refund records could not load.");});
    return()=>controller.abort();
  },[scopedPath,version]);
  async function send(path:string,body:Record<string,unknown>){
    if(lock.current)return;lock.current=true;setBusy(true);setError("");setNotice("");
    try{await portalApi(path,{method:"POST",body:JSON.stringify(body)});if(alive.current){setNotice("Refund review saved. The provider status determines when accounting changes.");setVersion(v=>v+1);}}
    catch(e){if(alive.current)setError(e instanceof Error?e.message:"The review could not be saved. Your request can be retried.");}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  async function create(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const data=new FormData(event.currentTarget);
    try{const amountKobo=minor(String(data.get("amount")));requestId.current??=crypto.randomUUID();await send("/v1/admin/finance/refunds",{universityId:data.get("universityId"),reference:String(data.get("reference")).trim(),amountKobo,requestId:requestId.current,reason:String(data.get("reason")).trim()});}
    catch(e){setError(e instanceof Error?e.message:"Check the refund details.");}
  }
  async function review(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const data=new FormData(event.currentTarget),action=String(data.get("action"));
    if(!selected)return;await send(`/v1/admin/finance/refunds/${encodeURIComponent(selected)}/${action}`,{reviewNote:String(data.get("reviewNote")).trim(),...(action==="approve"?{confirm:true}:{}),...(action==="provider"?{providerRefundId:String(data.get("providerRefundId")).trim()}: {})});
  }
  const row=rows.find(r=>r.id===selected),mayReview=can("finance.review");
  return <section className="panel form-stack" aria-label="Refund accounting">
    <div><h2>Refund review</h2><p>Review the original payment before returning funds. Collection fees stay recorded separately. Partial refunds, deliveries, subscriptions and released earnings require a reviewed policy.</p></div>
    {error?<p role="alert" className="notice notice--error">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
    <button type="button" className="button button--secondary" disabled={busy} onClick={()=>setVersion(v=>v+1)}>Refresh refunds</button>
    {mayReview?<details><summary>Request a refund review</summary><form className="form-stack" onSubmit={create} onChange={()=>{requestId.current=null;setNotice("");}}>
      <label>Campus<select required name="universityId" defaultValue={scope}><option value="">Choose campus</option>{access?.universities?.map(u=><option value={u.id} key={u.id}>{u.name}</option>)}</select></label>
      <label>Original payment reference<input required name="reference" maxLength={100} pattern="[A-Za-z0-9_.-]+" disabled={busy}/></label>
      <label>Customer refund (₦)<input required name="amount" inputMode="decimal" disabled={busy}/></label>
      <label>Reason<input required name="reason" minLength={10} maxLength={1000} disabled={busy}/></label>
      <button className="button button--primary" disabled={busy}>{busy?"Saving…":"Request review"}</button>
    </form></details>:null}
    {loaded&&!rows.length?<p>No refund requests for this scope.</p>:null}
    <div className="form-stack">{rows.map(r=><button type="button" className="button button--secondary" key={r.id} aria-pressed={selected===r.id} onClick={()=>setSelected(r.id)} disabled={busy} style={{textAlign:"left",whiteSpace:"normal",overflowWrap:"anywhere"}}>{money(r.customer_refund_kobo)} · {r.resource_type.replaceAll("_"," ")} · {r.status.replaceAll("_"," ")}<br/>{r.original_reference}</button>)}</div>
    {row?<div className="form-stack"><h3>{money(row.customer_refund_kobo)} refund</h3><p>Original payment {money(row.original_principal_kobo)} · original collection fee {money(row.original_collection_fee_kobo)}. {row.review_reason?row.review_reason.replaceAll("_"," ").toLowerCase():"Full unearned principal; independent review required."}</p>
      {mayReview&&["REQUESTED","APPROVED","REQUIRES_REVIEW"].includes(row.status)&&!row.provider_refund_id?<form className="form-stack" onSubmit={review} key={row.id+row.status}>
        <label>Action<select name="action"><option value="cancel">Cancel review</option>{row.status==="REQUESTED"?<option value="approve">Approve full principal review</option>:null}{row.status==="APPROVED"?<option value="provider">Bind refund created in Paystack Dashboard</option>:null}</select></label>
        {row.status==="APPROVED"?<label>Paystack refund ID<input name="providerRefundId" inputMode="numeric" pattern="[1-9][0-9]{0,19}"/></label>:null}
        <label>Review note<input required name="reviewNote" minLength={10} maxLength={2000}/></label><button className="button button--primary" disabled={busy}>Save review</button>
      </form>:null}
      {mayReview&&row.provider_refund_id&&["PROVIDER_PENDING","FAILED","SUCCEEDED"].includes(row.status)?<button disabled={busy} onClick={()=>void send(`/v1/admin/finance/refunds/${encodeURIComponent(row.id)}/check`,{})}>{busy?"Checking receipt…":"Check Paystack refund receipt"}</button>:null}
      <p>Refunds are created in Paystack Dashboard. Checking a receipt verifies its identity, amount and processed status before a matching accounting reversal.</p>
    </div>:null}
  </section>;
}
