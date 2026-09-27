"use client";
import {useEffect,useState,type FormEvent} from "react";
import {portalApi} from "@/lib/api";
import {useAdminContext} from "./admin-context";
import {PortalShell} from "./portal-shell";
type Rule={id:string;fee_type:string;version:string;effective_at:string;flat_kobo:number;basis_points:number;zone_id:string|null;reason:string};
type Dispute={id:string;title:string;amount_kobo:number;dispute_reason:string};
export function FeeRulesWorkspace(){
  const {scope,scopedPath,can}=useAdminContext();
  const [rules,setRules]=useState<Rule[]>([]),[disputes,setDisputes]=useState<Dispute[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(''),[refresh,setRefresh]=useState(0);
  const [zones,setZones]=useState<{id:string;name:string}[]>([]);
  const [kind,setKind]=useState('TUTOR_COMMISSION'),[version,setVersion]=useState(''),[effective,setEffective]=useState(''),[flat,setFlat]=useState('0'),[bps,setBps]=useState('0'),[minimum,setMinimum]=useState('0'),[maximum,setMaximum]=useState(''),[zone,setZone]=useState(''),[reason,setReason]=useState(''),[bands,setBands]=useState('');
  const key=scope+refresh;
  useEffect(()=>{let active=true;void portalApi<{rules:Rule[];disputes:Dispute[];zones:{id:string;name:string}[]}>(scopedPath('/v1/admin/operations/fee-rules')).then(r=>{if(active){setRules(r.rules);setDisputes(r.disputes);setZones(r.zones);setError('');}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoaded(key);});return()=>{active=false;};},[key,scopedPath]);
  async function save(e:FormEvent){e.preventDefault();setBusy(true);setError('');setNotice('');try{
    const parsedBands=bands.trim()?bands.trim().split('\n').map(line=>{const parts=line.split(',').map(s=>s.trim());if(parts.length!==3)throw new Error('Each distance band needs from metres, to metres (or *), fee in kobo.');return {fromMetres:Number(parts[0]),toMetres:parts[1]==='*'?null:Number(parts[1]),feeKobo:Number(parts[2])};}):[];
    await portalApi('/v1/admin/operations/fee-rules',{method:'POST',body:JSON.stringify({institutionId:scope,feeType:kind,version,effectiveAt:effective?new Date(effective).toISOString():new Date().toISOString(),flatKobo:Number(flat),basisPoints:Number(bps),minimumKobo:Number(minimum),maximumKobo:maximum?Number(maximum):null,zoneId:kind==='DELIVERY'&&zone?zone:null,bands:kind==='DELIVERY'?parsedBands:[],reason})});
    setNotice('Fee version saved. Existing purchases keep their original fees.');setVersion('');setReason('');setRefresh(v=>v+1);
  }catch(e){setError(e instanceof Error?e.message:'The fee rule could not be saved.');}finally{setBusy(false);}}
  return <PortalShell active="admin" eyebrow="Finance" title="Fee rules" description="Effective-dated fees and distance bands, with a permanent record of each version." actions={<button className="button button--secondary" onClick={()=>setRefresh(v=>v+1)}>Refresh</button>}>
    {error&&<p role="alert" className="workspace-notice">{error}</p>}{notice&&<p role="status" className="workspace-notice">{notice}</p>}
    {loaded!==key?<p>Loading fee rules…</p>:<div className="table-scroll"><table className="operational-table"><thead><tr><th>Fee</th><th>Version</th><th>Effective</th><th>Flat kobo</th><th>Basis points</th><th>Reason</th></tr></thead><tbody>{rules.map(r=><tr key={r.id}><td>{r.fee_type}</td><td>{r.version}</td><td>{new Date(r.effective_at).toLocaleString()}</td><td>{r.flat_kobo}</td><td>{r.basis_points}</td><td>{r.reason}</td></tr>)}</tbody></table>{!rules.length&&<p>No fee rules are configured in this scope.</p>}</div>}
    {can('finance.review')&&(scope?<form className="form-stack manage-form" onSubmit={save}><h2>Schedule a new version</h2>
      <label>Fee type<select value={kind} onChange={e=>setKind(e.target.value)}>{['TUTOR_COMMISSION','BUYER_SERVICE','WITHDRAWAL','RIDER_COMMISSION','DELIVERY'].map(k=><option key={k}>{k}</option>)}</select></label>
      <label>Version<input required minLength={3} maxLength={80} value={version} onChange={e=>setVersion(e.target.value)}/></label><label>Effective date (leave blank for now)<input type="datetime-local" value={effective} onChange={e=>setEffective(e.target.value)}/></label>
      <label>Flat fee in kobo<input required type="number" min={0} max={10000000} value={flat} onChange={e=>setFlat(e.target.value)}/></label><label>Percentage in basis points (1000 = 10%)<input required type="number" min={0} max={10000} value={bps} onChange={e=>setBps(e.target.value)}/></label>
      <label>Minimum kobo<input required type="number" min={0} value={minimum} onChange={e=>setMinimum(e.target.value)}/></label><label>Maximum kobo (optional)<input type="number" min={0} value={maximum} onChange={e=>setMaximum(e.target.value)}/></label>
      {kind==='DELIVERY'&&<><label>Delivery zone<select value={zone} onChange={e=>setZone(e.target.value)}><option value="">All university zones</option>{zones.map(z=><option key={z.id} value={z.id}>{z.name}</option>)}</select></label><label>Distance bands: from metres, to metres or *, fee kobo<textarea value={bands} onChange={e=>setBands(e.target.value)} placeholder={'0, 1000, 20000\n1000, *, 30000'}/></label><p>The flat fee is the configured fallback when distance is unavailable. Bands use inclusive starts and exclusive ends.</p></>}
      <p>Fee = flat kobo + percentage rounded to the nearest kobo, then minimum/maximum limits. At 1000 basis points, ₦300 has a ₦30 fee. A ₦20 fee uses 2000 flat kobo and zero basis points.</p>
      <label>Reason for this policy<input required minLength={10} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="button button--primary" disabled={busy}>{busy?'Saving…':'Save fee version'}</button>
    </form>:<p>Select a university before adding a fee rule.</p>)}
    <h2>Learning purchase disputes</h2><div className="table-scroll"><table className="operational-table"><thead><tr><th>Purchase</th><th>Amount</th><th>Issue</th></tr></thead><tbody>{disputes.map(d=><tr key={d.id}><td>{d.title}<small className="catalogue-ids">{d.id}</small></td><td>₦{(d.amount_kobo/100).toLocaleString()}</td><td>{d.dispute_reason}</td></tr>)}</tbody></table>{!disputes.length&&<p>No open learning purchase disputes.</p>}</div>
  </PortalShell>;
}
