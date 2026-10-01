"use client";
import {useEffect,useState,type FormEvent} from 'react';
import {useSearchParams} from 'next/navigation';
import {usePortalAuth} from './auth-provider';
import {portalApi} from '@/lib/api';
import {PhoneField,BirthDateField} from './intake-fields';
import {AgentApplicationIllustration} from './agent-illustrations';

type VendorDraft={businessName:string;legalName:string;description:string;address:string;category:string;campus:string;phone:string;birth:string;photo:string;request:string};
const blank:VendorDraft={businessName:'',legalName:'',description:'',address:'',category:'Groceries',campus:'',phone:'',birth:'',photo:'',request:''};
const categories=['Restaurant','Supermarket','Groceries','Fashion','Beauty','Electronics','Printing','Other'];
export function TrustedVendorApplication(){const {user}=usePortalAuth(),params=useSearchParams();return <TrustedVendorForm key={`${user?.id}:${params.get('invite')??''}`}/>;}
function TrustedVendorForm(){
 const params=useSearchParams(),{user}=usePortalAuth(),token=params.get('invite')??'';
 const [invite,setInvite]=useState<{university_name:string,application_id:string|null}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[submitted,setSubmitted]=useState(false),[draft,setDraft]=useState<VendorDraft>(blank),[draftKey,setDraftKey]=useState('');
 const update=(field:keyof VendorDraft,value:string)=>setDraft(d=>({...d,[field]:value}));
 useEffect(()=>{
  let active=true;
  void (async()=>{
   const r=await portalApi<{invite:{university_name:string,application_id:string|null}}>('/v1/trusted-vendors/invite',{method:'POST',body:JSON.stringify({token})});
   // The local draft is bound to this account and invitation. Store a digest,
   // never the invitation credential, and never restore another user's fields.
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
   const key=`k1.trusted-vendor.${user?.id}.${Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')}`;
   const restored:Partial<VendorDraft>={};try{const raw=sessionStorage.getItem(key);if(raw){const value=JSON.parse(raw);for(const field of Object.keys(blank) as (keyof VendorDraft)[])if(typeof value[field]==='string')restored[field]=value[field];}}catch{}
   if(active){setInvite(r.invite);setSubmitted(Boolean(r.invite.application_id));setDraft({...blank,...restored,request:restored.request||crypto.randomUUID()});setDraftKey(key);}
  })().catch(e=>{if(active)setError(e instanceof Error?e.message:'Your invitation could not be checked.');});
  return()=>{active=false;};
 },[token,user?.id]);
 useEffect(()=>{if(!draftKey)return;try{if(submitted)sessionStorage.removeItem(draftKey);else sessionStorage.setItem(draftKey,JSON.stringify(draft));}catch{}},[draftKey,draft,submitted]);
 async function upload(file:File){setBusy(true);setError('');try{const r=await portalApi<{id:string}>('/v1/media?kind=avatar&name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':file.type},body:file});update('photo',r.id);}catch(e){setError(e instanceof Error?e.message:'Photo could not upload.');}finally{setBusy(false);}}
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError('');
  try{await portalApi('/v1/trusted-vendors/submit',{method:'POST',body:JSON.stringify({token,requestId:draft.request,businessName:draft.businessName,legalName:draft.legalName,birthDate:draft.birth,description:draft.description,address:draft.address,category:draft.category,campus:draft.campus,phone:draft.phone,...(draft.photo?{profileMediaId:draft.photo}:{}),adultAuthorized:true,terms:true})});setSubmitted(true);}
  catch(e){setError(e instanceof Error?e.message:'Your application is kept. Try again.');}finally{setBusy(false);}
 }
 const uniben=invite?.university_name.toLowerCase()==='university of benin';
 return <main className="agent-login-page"><section className="agent-login-shell agent-onboarding-form trusted-vendor-onboarding" style={{maxWidth:620}}>
  <AgentApplicationIllustration step={2} complete={submitted}/><p className="eyebrow">By invitation</p><h1>{submitted?'Your business is under review':'Set up your vendor profile'}</h1><p>{invite?.university_name}</p>
  <p className="field-help">Your inviting team has waived ordinary application documents. An administrator will verify your business and contact details before approval.</p>
  {error?<p role="alert" className="form-error">{error}</p>:null}
  {submitted?<><p>We’ll email the decision. Once approved, your agent dashboard includes your shop and bank setup.</p><a className="button button--primary" href="https://agents.kampusone.app/agents/dashboard">Open agent dashboard</a></>:invite?<form className="form-stack" onSubmit={submit}>
   <label>Business name<input name="businessName" value={draft.businessName} onChange={e=>update('businessName',e.target.value)} required minLength={2} maxLength={160} placeholder="e.g. Osas Kitchen"/></label>
   <label>Your legal name<input name="legalName" value={draft.legalName} onChange={e=>update('legalName',e.target.value)} required minLength={2} maxLength={160} placeholder="e.g. Osas Egharevba" autoComplete="name"/></label>
   <BirthDateField value={draft.birth} onChange={value=>update('birth',value)}/><PhoneField id="trusted-phone" label="Business contact" value={draft.phone} onChange={value=>update('phone',value)}/>
   <label>Business category<select name="category" value={draft.category} onChange={e=>update('category',e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
   <label>Campus or service area{uniben?<select name="campus" required value={draft.campus} onChange={e=>update('campus',e.target.value)}><option value="" disabled>Choose your campus</option><option>Ugbowo</option><option>Ekehuan</option><option>Both campuses</option></select>:<input name="campus" value={draft.campus} onChange={e=>update('campus',e.target.value)} required maxLength={100} placeholder="e.g. Main campus"/>}</label>
   <label>Business address<input name="address" value={draft.address} onChange={e=>update('address',e.target.value)} required minLength={10} maxLength={500} placeholder="e.g. June 12 shopping complex"/></label>
   <label>Business description<textarea name="description" value={draft.description} onChange={e=>update('description',e.target.value)} required minLength={20} maxLength={2000} placeholder="What do you sell and when are you available?"/></label>
   <label>Business profile photo · optional<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);}}/>{draft.photo?<span className="field-help">Photo saved.</span>:null}</label>
   <label className="consent-row"><input type="checkbox" required/>I’m at least 18 and authorised to represent this business.</label><label className="consent-row"><input type="checkbox" required/>I accept the KampusOne agent terms and confirm these details are accurate.</label>
   <p className="field-help">Your progress is kept in this browser session until you submit.</p>
   <button className="button button--primary button--wide" disabled={busy||!draft.phone||!draft.birth||!draft.request}>{busy?'Saving…':'Submit vendor profile'}</button>
  </form>:!error?<p>Checking your invitation…</p>:null}
 </section></main>;
}
