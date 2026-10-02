"use client";
import {useEffect,useState,type FormEvent} from 'react';
import {useSearchParams} from 'next/navigation';
import {usePortalAuth} from './auth-provider';
import {portalApi} from '@/lib/api';
import {PhoneField,BirthDateField} from './intake-fields';
import {AgentApplicationIllustration} from './agent-illustrations';

type VendorDraft={businessName:string;legalName:string;description:string;address:string;category:string;campus:string;phone:string;birth:string;photo:string;businessDocumentIds:string[];request:string};
const blank:VendorDraft={businessName:'',legalName:'',description:'',address:'',category:'Groceries',campus:'',phone:'',birth:'',photo:'',businessDocumentIds:[],request:''};
const categories=['Restaurant','Supermarket','Groceries','Fashion','Beauty','Electronics','Printing','Other'];
export function TrustedVendorApplication(){const {user}=usePortalAuth(),params=useSearchParams();return <TrustedVendorForm key={`${user?.id}:${params.get('invite')??''}`}/>;}
function TrustedVendorForm(){
 const params=useSearchParams(),{user}=usePortalAuth(),token=params.get('invite')??'';
 const [invite,setInvite]=useState<{university_name:string,application_id:string|null}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[submitted,setSubmitted]=useState(false),[draft,setDraft]=useState<VendorDraft>(blank),[draftKey,setDraftKey]=useState(''),[fieldErrors,setFieldErrors]=useState<Record<string,string>>({});
 const validToken=/^[a-f0-9]{64}$/.test(token);
 const update=<K extends keyof VendorDraft>(field:K,value:VendorDraft[K])=>setDraft(d=>({...d,[field]:value}));
 useEffect(()=>{
  let active=true;
  if(!validToken)return()=>{active=false;};
  void (async()=>{
   const r=await portalApi<{invite:{university_name:string,application_id:string|null}}>('/v1/trusted-vendors/invite',{method:'POST',body:JSON.stringify({token})});
   // The local draft is bound to this account and invitation. Store a digest,
   // never the invitation credential, and never restore another user's fields.
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
   const key=`k1.trusted-vendor.${user?.id}.${Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')}`;
   const restored:Partial<VendorDraft>={};try{const raw=sessionStorage.getItem(key);if(raw){const value=JSON.parse(raw) as Record<string,unknown>;for(const field of Object.keys(blank) as (keyof VendorDraft)[]){const saved=value[field];if(field==='businessDocumentIds'&&Array.isArray(saved))restored.businessDocumentIds=saved.filter((entry):entry is string=>typeof entry==='string').slice(0,4);else if(typeof saved==='string')(restored as Record<string,unknown>)[field]=saved;}}}catch{}
   if(active){setInvite(r.invite);setSubmitted(Boolean(r.invite.application_id));setDraft({...blank,...restored,request:restored.request||crypto.randomUUID()});setDraftKey(key);}
  })().catch(e=>{if(active)setError(e instanceof Error?e.message:'Your invitation could not be checked.');});
  return()=>{active=false;};
 },[token,user?.id,validToken]);
 useEffect(()=>{if(!draftKey)return;try{if(submitted)sessionStorage.removeItem(draftKey);else sessionStorage.setItem(draftKey,JSON.stringify(draft));}catch{}},[draftKey,draft,submitted]);
 useEffect(()=>{if(submitted)window.location.replace('https://agents.kampusone.app/agents');},[submitted]);
 async function upload(file:File){setBusy(true);setError('');try{const body=new FormData();body.append('kind','avatar');body.append('file',file);const r=await portalApi<{id:string}>('/v1/media',{method:'POST',body});update('photo',r.id);}catch(e){setError(e instanceof Error?e.message:'Photo could not upload.');}finally{setBusy(false);}}
 async function uploadDocuments(files:FileList){
  const selected=Array.from(files).slice(0,Math.max(0,4-draft.businessDocumentIds.length));
  if(!selected.length)return;
  const allowed=['image/jpeg','image/png','image/webp','application/pdf'];
  if(selected.some(file=>!allowed.includes(file.type)||file.size>10*1024*1024)){setFieldErrors(current=>({...current,businessDocumentIds:'Use JPG, PNG, WebP or PDF files up to 10 MB each.'}));return;}
  setBusy(true);setError('');setFieldErrors(current=>({...current,businessDocumentIds:''}));
  try{const ids=[...draft.businessDocumentIds];for(const file of selected){const body=new FormData();body.append('kind','kyc');body.append('file',file);const r=await portalApi<{id:string}>('/v1/media',{method:'POST',body});ids.push(r.id);}setDraft(current=>({...current,businessDocumentIds:[...new Set(ids)].slice(0,4)}));}
  catch(e){setError(e instanceof Error?e.message:'Document could not upload.');}finally{setBusy(false);}
 }
 async function uploadDocument(file?:File){
  if(!file||busy)return;
  if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)){setFieldErrors(current=>({...current,businessDocumentIds:'Choose a JPG, PNG, WebP or PDF document.'}));return;}
  if(file.size>10*1024*1024){setFieldErrors(current=>({...current,businessDocumentIds:'Choose a file smaller than 10 MB.'}));return;}
  setBusy(true);setError('');setFieldErrors(current=>({...current,businessDocumentIds:''}));
  try{const body=new FormData();body.append('kind','kyc');body.append('file',file);const r=await portalApi<{id:string}>('/v1/media',{method:'POST',body});setDraft(current=>({...current,businessDocumentIds:[...current.businessDocumentIds,r.id].slice(-4)}));}
  catch(e){setError(e instanceof Error?e.message:'Document could not upload. Choose the file and retry.');}
  finally{setBusy(false);}
 }
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setError('');setFieldErrors({});
  const errors:Record<string,string>={};
  const birthday=/^\d{4}-\d{2}-\d{2}$/.test(draft.birth)?new Date(draft.birth+'T00:00:00Z'):null;
  let age=0;if(birthday&&!Number.isNaN(birthday.getTime())){const today=new Date();age=today.getUTCFullYear()-birthday.getUTCFullYear();if(today.getUTCMonth()<birthday.getUTCMonth()||(today.getUTCMonth()===birthday.getUTCMonth()&&today.getUTCDate()<birthday.getUTCDate()))age--;}
  if(draft.businessName.trim().length<2)errors.businessName='Enter the business name.';
  if(draft.legalName.trim().length<2)errors.legalName='Enter your legal name.';
  if(age<18||age>110)errors.birth='Invited business representatives must be at least 18.';
  if(!/^\+234[789]\d{9}$/.test(draft.phone))errors.phone='Use a Nigerian mobile number, for example +2348012345678.';
  if(draft.campus.trim().length<2)errors.campus='Choose or enter the campus you serve.';
  if(draft.address.trim().length<10)errors.address='Enter a complete business address.';
  if(draft.description.trim().length<20)errors.description='Describe the business in at least 20 characters.';
  if(!draft.businessDocumentIds.length)errors.businessDocumentIds='Upload at least one school or business document.';
  if(Object.keys(errors).length){setFieldErrors(errors);setError('Check the highlighted information below. Your progress is still saved.');return;}
  setBusy(true);
  try{await portalApi('/v1/trusted-vendors/submit',{method:'POST',body:JSON.stringify({token,requestId:draft.request,businessName:draft.businessName.trim(),legalName:draft.legalName.trim(),birthDate:draft.birth,description:draft.description.trim(),address:draft.address.trim(),category:draft.category,campus:draft.campus.trim(),phone:draft.phone,businessDocumentIds:draft.businessDocumentIds,...(draft.photo?{profileMediaId:draft.photo}:{}),adultAuthorized:true,terms:true})});setSubmitted(true);if(draftKey)try{sessionStorage.removeItem(draftKey);}catch{}window.location.replace('https://agents.kampusone.app/agents');}
  catch(e){setError(e instanceof Error?e.message:'Your application is kept. Try again.');}finally{setBusy(false);}
 }
 const uniben=invite?.university_name.toLowerCase()==='university of benin';
 if(!validToken)return <main className="agent-login-page"><section className="agent-login-shell agent-onboarding-form trusted-vendor-onboarding" style={{maxWidth:620}}>
  <AgentApplicationIllustration step={2} complete={false}/>
  <p className="eyebrow">Agent network</p>
  <h1>Choose how you want to work on campus.</h1>
  <p className="field-help">KampusOne agents can join as a vendor, tutor or rider. Start the normal application below, or reopen the complete private link if an administrator invited you directly.</p>
  <fieldset className="agent-role-options" aria-label="Available agent roles">
   <legend>Available roles</legend>
   <div className="agent-role-card"><span className="agent-role-mark" aria-hidden="true">V</span><span className="agent-role-copy"><strong>Vendor</strong><small>Sell products or run a campus business.</small></span></div>
   <div className="agent-role-card"><span className="agent-role-mark" aria-hidden="true">T</span><span className="agent-role-copy"><strong>Tutor</strong><small>Teach courses, cohorts or study sessions.</small></span></div>
   <div className="agent-role-card"><span className="agent-role-mark" aria-hidden="true">R</span><span className="agent-role-copy"><strong>Rider</strong><small>Handle approved campus deliveries.</small></span></div>
  </fieldset>
  <a className="button button--primary button--wide" href="/agents">Start agent application</a>
  <p className="field-help">Have a private invitation? Open the complete invitation link from the message you received.</p>
 </section></main>;
 const displayError=error;
 return <main className="agent-login-page"><section className="agent-login-shell agent-onboarding-form trusted-vendor-onboarding" style={{maxWidth:620}}>
  <AgentApplicationIllustration step={2} complete={submitted}/><p className="eyebrow">By invitation</p><h1>{submitted?'Your business is under review':'Set up your invited vendor profile'}</h1><p>{invite?.university_name}</p>
  <p className="field-help">Upload at least one school or business document for the private review. CAC registration is optional. Your evidence stays private and is only available to authorised reviewers.</p>
  {displayError?<p role="alert" className="form-error">{displayError}</p>:null}
  {submitted?<><p>Your invited vendor profile was submitted. Returning you to the agent application.</p><a className="button button--primary" href="https://agents.kampusone.app/agents">Return to agent application</a></>:invite?<form className="form-stack" onSubmit={submit}>
   <label>Business name<input aria-invalid={Boolean(fieldErrors.businessName)} name="businessName" value={draft.businessName} onChange={e=>update('businessName',e.target.value)} required minLength={2} maxLength={160} placeholder="e.g. Osas Kitchen"/>{fieldErrors.businessName?<span className="field-error">{fieldErrors.businessName}</span>:null}</label>
   <label>Your legal name<input aria-invalid={Boolean(fieldErrors.legalName)} name="legalName" value={draft.legalName} onChange={e=>update('legalName',e.target.value)} required minLength={2} maxLength={160} placeholder="e.g. Osas Egharevba" autoComplete="name"/>{fieldErrors.legalName?<span className="field-error">{fieldErrors.legalName}</span>:null}</label>
   <BirthDateField value={draft.birth} minAge={18} error={fieldErrors.birth} onChange={value=>update('birth',value)}/><PhoneField id="trusted-phone" label="Business contact" value={draft.phone} error={fieldErrors.phone} onChange={value=>update('phone',value)}/>
   <label>Business category<select name="category" value={draft.category} onChange={e=>update('category',e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
   <label>Campus or service area{uniben?<select name="campus" required value={draft.campus} onChange={e=>update('campus',e.target.value)}><option value="" disabled>Choose your campus</option><option>Ugbowo</option><option>Ekehuan</option><option>Both campuses</option></select>:<input name="campus" value={draft.campus} onChange={e=>update('campus',e.target.value)} required maxLength={100} placeholder="e.g. Main campus"/>}{fieldErrors.campus?<span className="field-error">{fieldErrors.campus}</span>:null}</label>
   <label>Business address<input name="address" value={draft.address} onChange={e=>update('address',e.target.value)} required minLength={10} maxLength={500} placeholder="e.g. June 12 shopping complex"/>{fieldErrors.address?<span className="field-error">{fieldErrors.address}</span>:null}</label>
   <label>Business description<textarea name="description" value={draft.description} onChange={e=>update('description',e.target.value)} required minLength={20} maxLength={2000} placeholder="What do you sell and when are you available?"/>{fieldErrors.description?<span className="field-error">{fieldErrors.description}</span>:null}</label>
   <div className="document-upload"><label>School or business documents (CAC optional)<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy||draft.businessDocumentIds.length>=4} onChange={e=>{void uploadDocument(e.target.files?.[0]);e.target.value='';}}/></label><span className="field-help">{draft.businessDocumentIds.length?`${draft.businessDocumentIds.length} private document${draft.businessDocumentIds.length===1?'':'s'} uploaded. You can add up to 4.`:'Upload at least one JPG, PNG, WebP or PDF · up to 10 MB each.'}</span>{fieldErrors.businessDocumentIds?<span className="field-error">{fieldErrors.businessDocumentIds}</span>:null}</div>
   <label>Business profile photo · optional<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);}}/>{draft.photo?<span className="field-help">Photo saved.</span>:null}</label>
   <label>School or business documents · required<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple disabled={busy||draft.businessDocumentIds.length>=4} onChange={e=>{if(e.target.files?.length)void uploadDocuments(e.target.files);e.currentTarget.value='';}}/><span className="field-help">JPG, PNG, WebP or PDF · up to 10 MB each · maximum 4 files. CAC registration is optional.</span>{draft.businessDocumentIds.length?<span className="field-help">{draft.businessDocumentIds.length} document{draft.businessDocumentIds.length===1?'':'s'} uploaded privately.</span>:null}{fieldErrors.businessDocumentIds?<span className="field-error">{fieldErrors.businessDocumentIds}</span>:null}</label>
   <label className="consent-row"><input type="checkbox" required/>I’m at least 18 and authorised to represent this business.</label><label className="consent-row"><input type="checkbox" required/>I accept the KampusOne agent terms and confirm these details are accurate.</label>
   <p className="field-help">Your progress is kept in this browser session until you submit.</p>
   <button className="button button--primary button--wide" disabled={busy||!draft.phone||!draft.birth||!draft.request}>{busy?'Saving…':'Submit vendor profile'}</button>
  </form>:!displayError?<p>Checking your invitation…</p>:null}
 </section></main>;
}
