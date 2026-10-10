import {randomBytes} from 'node:crypto';
import {appendFileSync,readFileSync} from 'node:fs';

// An expiring, token-protected preview; never a production route or user prompt.
export async function probe(request, env) {
  const supplied=request.headers.get('x-probe-token')??'', expiry=Number(env.PROBE_EXPIRES_AT);
  if(request.method!=='POST'||new URL(request.url).pathname!=='/__kira_probe'||!/^[a-f0-9]{64}$/.test(supplied)||!/^[a-f0-9]{64}$/.test(env.PROBE_TOKEN??'')||!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+240000)return new Response(null,{status:404});
  let difference=0;for(let i=0;i<64;i++)difference|=supplied.charCodeAt(i)^env.PROBE_TOKEN.charCodeAt(i);
  if(difference)return new Response(null,{status:404});
  const messages=[{role:'system',content:'Answer briefly and accurately.'},{role:'user',content:"State Ohm's law in one sentence."}];
  const modelCheck=async(model)=>{
    try {
      const result=await env.AI.run(model,{messages,max_tokens:128,temperature:0.1,stream:false},{signal:AbortSignal.timeout(35000)});
      const text=typeof result?.response==='string'?result.response:result?.choices?.[0]?.message?.content;
      return {outcome:typeof text==='string'&&text.trim().length>8?'generation_succeeded':'generation_unusable'};
    }catch(error){const code=/\b(3036|3040|5035|5016|5018|3023|3041|3007|3008|5007|3042)\b/.exec(String(error?.message??''))?.[1];return{outcome:'provider_rejected',...(code?{code}: {})};}
  };
  const hfCheck=async()=>{
    if(!env.HF_TOKEN||!env.HF_CHAT_MODEL)return{outcome:'configuration_missing'};
    try {
      const r=await fetch('https://router.huggingface.co/v1/chat/completions',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(35000),headers:{Authorization:`Bearer ${env.HF_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.HF_CHAT_MODEL,messages,max_tokens:128,temperature:0.1,stream:false})});
      if(r.ok){await r.body?.cancel();return{outcome:'generation_succeeded',http:r.status};}
      const data=await r.json().catch(()=>({}));
      const message=typeof data?.error==='string'?data.error:typeof data?.error?.message==='string'?data.error.message:'';
      return{outcome:'provider_rejected',http:r.status,hint:/credit|pre.?paid|payment|balance/i.test(message)?'credits_or_payment':r.status===429?'rate_limit':'unclassified'};
    }catch{return{outcome:'transport_failure'};}
  };
  const bachs={configured:Boolean(env.BACHS_API_KEY&&env.BACHS_WEBHOOK_SECRET),liveKey:env.BACHS_API_KEY?.startsWith('sk_live_')===true};
  if(bachs.configured) {
    try {
      const origin=bachs.liveKey?'https://api.bachs.io':'https://sandbox-api.bachs.io';
      const r=await fetch(origin+'/v1/accounts/checkout/settings',{headers:{Authorization:'Bearer '+env.BACHS_API_KEY},redirect:'manual',signal:AbortSignal.timeout(10000)});
      const d=await r.json().catch(()=>null);
      bachs.http=r.status;bachs.bankTransferEnabled=d?.enabled_payment_methods?.NGN_BANK_TRANSFER?.enabled===true;
      bachs.feePreference=['org_pays','customer_pays'].includes(d?.fee_preference)?d.fee_preference:'unknown';
    }catch(error){bachs.outcome='transport_failure';bachs.failure=error?.name==='TypeError'?'request_type':error?.name==='TimeoutError'?'timeout':'network';}
  }
  if(env.PROBE_METADATA_ONLY==='true'){
    let webhooks={http:0,targets:[]};
    try{
      const r=await fetch('https://api.bachs.io/v1/webhooks/endpoints?limit=100',{headers:{Authorization:'Bearer '+env.BACHS_API_KEY},redirect:'manual',signal:AbortSignal.timeout(10000)});
      const d=await r.json().catch(()=>null),items=Array.isArray(d)?d:Array.isArray(d?.items)?d.items:[];
      webhooks={http:r.status,targets:items.slice(0,100).map(e=>{let target='other_host';try{const u=new URL(e.url);if(['platformp.divine-haze-54eb.workers.dev','mobile.kampusone.app','api.kampusone.app'].includes(u.hostname))target=u.origin+u.pathname;}catch{}return{target,enabled:e.enabled===true,successEvents:Array.isArray(e.event_types)&&e.event_types.some(t=>['checkout.completed','collection.succeeded'].includes(t))};})};
    }catch{/* Classified metadata only. No endpoint secrets or event bodies. */}
    return Response.json({kind:'kampusone-kira-probe-v1',bachs,webhooks},{headers:{'Cache-Control':'no-store'}});
  }
  const convert=async(name,blob)=>{
    if(typeof env.AI?.toMarkdown!=='function')return{outcome:'configuration_missing'};
    let timer;try{
      const result=await Promise.race([env.AI.toMarkdown([{name,blob}]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),20000);})]);
      return{outcome:typeof result?.[0]?.data==='string'&&/MAT\s*101/.test(result[0].data)?'conversion_succeeded':'conversion_unusable'};
    }catch{return{outcome:'provider_rejected'};}finally{clearTimeout(timer);}
  };
  const extended=async()=>{
    if(env.PROBE_VERIFY_UPLOADS!=='true')return{};
    const png=Uint8Array.from(atob(env.PROBE_TIMETABLE_PNG),c=>c.charCodeAt(0));
    const stream='BT /F1 20 Tf 30 150 Td (Monday: MAT 101, 8:00 AM to 9:00 AM, Lecture Hall 1.) Tj ET';
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 740 240] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
    let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
    const xref=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const checkoutCheck=async()=>{
      if(!bachs.liveKey||!bachs.bankTransferEnabled||bachs.feePreference!=='org_pays')return{outcome:'configuration_missing'};
      const reference='K1-DIAG-B-'+crypto.randomUUID(),origin='https://api.bachs.io';
      try{
        const r=await fetch(origin+'/v1/checkout-sessions',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+env.BACHS_API_KEY,'Content-Type':'application/json','Idempotency-Key':reference},body:JSON.stringify({pricing:{currency:'NGN',amount:'6000.00'},reference,payment_method_types:['NGN_BANK_TRANSFER'],expires_in_minutes:2,metadata:{purpose:'UNPAID_RELEASE_DIAGNOSTIC'}})});
        const data=await r.json().catch(()=>null);
        if(!r.ok)return{outcome:'provider_rejected',http:r.status};
        if(typeof data?.checkout_id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(data.checkout_id)||data.reference!==reference||data.status!=='open')return{outcome:'checkout_unusable'};
        const detail=await fetch(origin+'/v1/checkout-sessions/'+encodeURIComponent(data.checkout_id),{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+env.BACHS_API_KEY}});
        const receipt=await detail.json().catch(()=>null);
        return{outcome:detail.ok&&receipt?.reference===reference&&receipt?.status==='open'&&receipt?.currency==='NGN'&&Number(receipt?.amount)===6000?'unpaid_checkout_succeeded':'checkout_unusable',http:detail.status};
      }catch{return{outcome:'transport_failure'};}
    };
    const [image,pdfConversion,unpaidCheckout]=await Promise.all([convert('synthetic-timetable.png',new Blob([png],{type:'image/png'})),convert('synthetic-timetable.pdf',new Blob([pdf],{type:'application/pdf'})),checkoutCheck()]);
    return{image,pdf:pdfConversion,unpaidCheckout};
  };
  const [standard,pro,huggingface,conversion,uploads]=await Promise.all([modelCheck('@cf/meta/llama-3.1-8b-instruct-fast'),modelCheck('@cf/meta/llama-3.3-70b-instruct-fp8-fast'),hfCheck(),convert('probe.txt',new Blob(['Monday: MAT 101, 8:00 AM to 9:00 AM, Lecture Hall 1.'],{type:'text/plain'})),extended()]);
  return Response.json({kind:'kampusone-kira-probe-v1',standard,pro,huggingface,bachs,conversion,uploads},{headers:{'Cache-Control':'no-store'}});
}

if(process.argv.includes('--self-test')) {
  const token=randomBytes(32).toString('hex');
  const env={PROBE_TOKEN:token,PROBE_EXPIRES_AT:String(Date.now()+180000),AI:{run:async()=>({response:'Voltage equals current multiplied by resistance.'})}};
  const invalid=await probe(new Request('https://test.invalid/__kira_probe',{method:'POST',headers:{'x-probe-token':'0'.repeat(64)}}),env);
  if(invalid.status!==404)throw new Error('Probe token boundary failed');
  const response=await probe(new Request('https://test.invalid/__kira_probe',{method:'POST',headers:{'x-probe-token':token}}),env);
  const data=await response.json();if(data.standard.outcome!=='generation_succeeded'||data.pro.outcome!=='generation_succeeded')throw new Error('Probe result failed');
  console.log('PASS: isolated probe requires the token and returns classified outcomes only.');
} else {
  const lines=[],report=line=>{console.log(line);lines.push(line);};
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  const fetchSafe=(url,options={})=>fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(45000)});
  const cf=async(suffix,options={})=>{
    const response=await fetchSafe(`https://api.cloudflare.com/client/v4/accounts/${account}${suffix}`,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();if(!data.success)throw new Error('Cloudflare operation failed');return data.result;
  };
  let stage='configuration';
  try {
    if(!token||!/^[a-f0-9]{32}$/i.test(account??''))throw new Error('Deployment credentials unavailable');
    stage='binding metadata';
    const settings=await cf('/workers/scripts/platformp/settings');
    const inherited=['HF_TOKEN','HF_CHAT_MODEL','BACHS_API_KEY','BACHS_WEBHOOK_SECRET'].filter(name=>settings.bindings?.some(b=>b.name===name)).map(name=>({name,type:'inherit'}));
    report(`Production BACHS API secret present: ${settings.bindings?.some(b=>b.name==='BACHS_API_KEY')===true}`);
    report(`Production BACHS webhook secret present: ${settings.bindings?.some(b=>b.name==='BACHS_WEBHOOK_SECRET')===true}`);
    report(`Production Workers AI binding present: ${settings.bindings?.some(b=>b.name==='AI'&&b.type==='ai')===true}`);
    report(`Production binding count: ${settings.bindings?.length??0}`);
    stage='isolated preview session';
    const session=await cf('/workers/scripts/platformp/subdomain/edge-preview');
    let sessionToken=session.token,host='platformp.divine-haze-54eb.workers.dev';
    if(session.exchange_url){
      const exchange=new URL(session.exchange_url);
      if(exchange.protocol!=='https:'||!['.cloudflarepreviews.com','.workers.dev'].some(suffix=>exchange.hostname.endsWith(suffix)))throw new Error('Unexpected preview host');
      const r=await fetchSafe(exchange.href);if(r.ok){const data=await r.json();if(typeof data.token==='string')sessionToken=data.token;}
      host='platformp'+exchange.hostname.slice(exchange.hostname.indexOf('.'));
    }
    if(typeof sessionToken!=='string')throw new Error('Missing preview session');
    const form=new FormData(),probeToken=randomBytes(32).toString('hex');
    const png=process.env.PROBE_VERIFY_UPLOADS==='true'?readFileSync(new URL('./fixtures/synthetic-timetable.png',import.meta.url)).toString('base64'):'';
    form.set('metadata',JSON.stringify({main_module:'probe.mjs',compatibility_date:'2026-09-09',bindings:[...inherited,{name:'AI',type:'ai'},{name:'PROBE_TOKEN',type:'plain_text',text:probeToken},{name:'PROBE_EXPIRES_AT',type:'plain_text',text:String(Date.now()+180000)},{name:'PROBE_VERIFY_UPLOADS',type:'plain_text',text:process.env.PROBE_VERIFY_UPLOADS==='true'?'true':'false'},{name:'PROBE_METADATA_ONLY',type:'plain_text',text:process.env.PROBE_METADATA_ONLY==='true'?'true':'false'}]}));
    form.set('probe.mjs',new Blob([`export default {fetch: (request,env)=>(${probe.toString()})(request,{...env,PROBE_TIMETABLE_PNG:${JSON.stringify(png)}})};`],{type:'application/javascript+module'}),'probe.mjs');
    form.set('wrangler-session-config',JSON.stringify({workers_dev:true}));
    stage='preview upload';
    const preview=await cf('/workers/scripts/platformp/edge-preview',{method:'POST',body:form,headers:{'cf-preview-upload-config-token':sessionToken}});
    if(typeof preview.preview_token!=='string')throw new Error('Missing preview token');
    stage='live inference';
    const r=await fetchSafe(`https://${host}/__kira_probe`,{method:'POST',headers:{'cf-workers-preview-token':preview.preview_token,'x-probe-token':probeToken}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const result=await r.json();if(result.kind!=='kampusone-kira-probe-v1')throw new Error('Unexpected probe result');
    const outcomes=new Set(['generation_succeeded','generation_unusable','provider_rejected','configuration_missing','transport_failure']);
    if(process.env.PROBE_METADATA_ONLY!=='true')for(const name of ['standard','pro','huggingface']){
      const value=result[name];if(!outcomes.has(value?.outcome))throw new Error('Unexpected outcome');
      report(`${name}: ${value.outcome}${Number.isInteger(value.http)?` HTTP ${value.http}`:''}${/^\d{4}$/.test(value.code??'')?` code ${value.code}`:''}${['credits_or_payment','rate_limit','unclassified'].includes(value.hint)?` ${value.hint}`:''}`);
    }
    report(`BACHS configuration complete: ${result.bachs?.configured===true}; live key: ${result.bachs?.liveKey===true}`);
    report(`BACHS settings: HTTP ${Number.isInteger(result.bachs?.http)?result.bachs.http:'unavailable'}; bank transfer enabled: ${result.bachs?.bankTransferEnabled===true}; fee preference: ${['org_pays','customer_pays'].includes(result.bachs?.feePreference)?result.bachs.feePreference:'unknown'}; failure: ${['request_type','timeout','network'].includes(result.bachs?.failure)?result.bachs.failure:'none'}`);
    if(process.env.PROBE_METADATA_ONLY==='true')report(`BACHS webhook targets: ${JSON.stringify(result.webhooks)}`);
    else report(`Private file conversion: ${['conversion_succeeded','conversion_unusable','configuration_missing','provider_rejected'].includes(result.conversion?.outcome)?result.conversion.outcome:'unknown'}`);
    if(process.env.PROBE_VERIFY_UPLOADS==='true')for(const name of ['image','pdf','unpaidCheckout']){
      const outcome=result.uploads?.[name]?.outcome,allowed=['conversion_succeeded','conversion_unusable','configuration_missing','provider_rejected','transport_failure','unpaid_checkout_succeeded','checkout_unusable'];
      report(`${name}: ${allowed.includes(outcome)?outcome:'unknown'}`);
      if(outcome!==(name==='unpaidCheckout'?'unpaid_checkout_succeeded':'conversion_succeeded'))process.exitCode=1;
    }
    if(process.env.PROBE_METADATA_ONLY!=='true'&&(result.standard.outcome!=='generation_succeeded'||result.pro.outcome!=='generation_succeeded'))process.exitCode=1;
    report('No production route, credential export, account data or application write. Extended verification creates one unpaid BACHS checkout that expires in two minutes; no charge. Preview expires after three minutes.');
  }catch(error){report(`CHECK FAILED at ${stage}: ${/^HTTP [1-5][0-9]{2}$/.test(error?.message??'')?error.message:'raw error withheld'}`);process.exitCode=1;}
  finally{if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');}
}
