// Synthetic API fixtures; no real applications, accounts, emails or campaign changes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'portal/package.json'));
const {chromium}=require(process.env.EXCLUSIVE_TEST_PLAYWRIGHT_MODULE??'playwright');
const output=process.env.EXCLUSIVE_TEST_OUTPUT??fs.mkdtempSync(path.join(os.tmpdir(),'kampusone-exclusive-'));
fs.mkdirSync(output,{recursive:true});
const port=Number(process.env.EXCLUSIVE_TEST_PORT??3123);
const origin=`http://127.0.0.1:${port}`;
let enabled=true;
const api=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({enabled}));});
await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
const log=fs.openSync(path.join(output,'next.log'),'w');
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{
 cwd:path.join(root,'portal'),env:{...process.env,KAMPUSONE_API_ORIGIN:`http://127.0.0.1:${api.address().port}`},stdio:['ignore',log,log],
});
const user={id:'11111111-1111-4111-8111-111111111111',email:'exclusive.fixture@example.invalid',roles:['STUDENT'],operatorRoles:[],universityId:'22222222-2222-4222-8222-222222222222'};
const results={fixtureOnly:true,checks:[],pageErrors:[],submissions:[]};
let browser;
try {
 for(let attempt=0;attempt<100;attempt++){
  if(server.exitCode!==null)throw Error('Portal startup failed; inspect next.log');
  try{if((await fetch(origin+'/exclusive')).ok)break;}catch{}
  if(attempt===99)throw Error('Portal did not start');
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 browser=await chromium.launch({executablePath:process.env.EXCLUSIVE_TEST_CHROMIUM,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const [agentType,width] of [['VENDOR',390],['TUTOR',390],['RIDER',1280]]){
  console.log(`Checking ${agentType} at ${width}px`);
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  const page=await context.newPage();
  page.on('pageerror',error=>results.pageErrors.push(error.message));
  const applications=[];
  let failContext=false;
  await context.route('**/v1/**',async route=>{
   const request=route.request(),pathname=new URL(request.url()).pathname;
   const send=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':origin,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type, Authorization, X-Device-Label','access-control-allow-methods':'GET, POST, PATCH, OPTIONS'},body:JSON.stringify(body)});
   if(request.method()==='OPTIONS')return send({});
   if(pathname.endsWith('/auth/refresh'))return send({accessToken:'fixture-token',refreshToken:'fixture-refresh',expiresIn:3600,user});
   if(pathname.endsWith('/trusted-vendors/context'))return failContext?send({error:{code:'PROVIDER_UNAVAILABLE',message:'Fixture: Exclusive onboarding unavailable.'}},503):send({context:{university_name:'Fixture campus',applications,application_id:null}});
   if(pathname.endsWith('/trusted-vendors/submit')){
    const body=request.postDataJSON();
    assert.equal(body.agentType,agentType);
    assert.equal(body.category,agentType==='VENDOR'?'Other':agentType==='TUTOR'?'Tutoring':'Delivery');
    assert.equal(body.adultAuthorized,true);assert.equal(body.terms,true);assert.equal(body.token,undefined);
    assert.equal(body.operations.primaryOffer,'Fixture campus service');
    results.submissions.push({agentType:body.agentType,category:body.category});
    const id=crypto.randomUUID();applications.push({id,agent_type:agentType,status:'SUBMITTED'});
    return send({id,status:'SUBMITTED'},201);
   }
   return send({});
  });
  await page.goto(origin+'/exclusive');
  await page.getByRole('heading',{name:'Your Exclusive agent profile'}).waitFor();
  const roleName=agentType==='VENDOR'?'Vendor':agentType==='TUTOR'?'Tutor':'Rider';
  await page.getByRole('radio').first().waitFor({state:'visible'});
  assert.equal(await page.getByRole('radio').count(),3);
  assert.equal(await page.getByRole('radio',{checked:true}).count(),0);
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByText('Choose Vendor, Tutor or Rider.',{exact:true}).waitFor();
  await page.getByRole('radio',{name:new RegExp('^'+roleName)}).check();
  await page.getByLabel(/^Full name/).fill('Exclusive Fixture Agent');
  await page.getByLabel('Birth Day').selectOption('01');
  await page.getByLabel('Birth Month').selectOption('01');
  await page.getByLabel('Birth Year').selectOption('2000');
  await page.locator('#exclusive-phone').fill('8012345678');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  const nameLabel=agentType==='VENDOR'?'Business name':agentType==='TUTOR'?'Tutor or teaching name':'Rider or delivery service name';
  await page.getByLabel(nameLabel,{exact:true}).fill('Exclusive Fixture Service');
  if(agentType==='VENDOR')await page.getByLabel(/^Business category/).selectOption('Other');
  else assert.equal(await page.getByLabel(/^Business category/).count(),0);
  await page.getByLabel('Campus or service area',{exact:true}).fill('Fixture campus');
  const addressLabel=agentType==='VENDOR'?'Business or pickup address':agentType==='TUTOR'?'Teaching or contact address':'Base or pickup address';
  await page.getByLabel(addressLabel,{exact:true}).fill('12 Fixture Road, Campus service area');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  const offerLabel=agentType==='VENDOR'?'What products or services do you offer?':agentType==='TUTOR'?'Which courses or subjects do you teach?':'What delivery services and areas do you cover?';
  await page.getByLabel(offerLabel,{exact:true}).fill('Fixture campus service');
  await page.getByLabel('What brings you to KampusOne?').selectOption('Reach more students');
  await page.getByLabel('Monday',{exact:true}).check();
  await page.getByLabel('From',{exact:true}).fill('08:00');await page.getByLabel('To',{exact:true}).fill('18:00');
  await page.getByLabel('Meet at an agreed location',{exact:true}).check();
  await page.getByLabel(/^Customer support/).selectOption('WhatsApp');
  await page.getByLabel(/^Usual response time/).selectOption('Within 1 hour');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('heading',{name:'Review & submit',exact:true}).waitFor();
  assert.match(await page.locator('dl.application-review').innerText(),new RegExp(roleName));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,`${agentType.toLowerCase()}-review-${width}.png`),fullPage:true});
  await page.getByLabel('I am at least 18 and authorised to offer these products or services.').check();
  await page.getByLabel('I accept the agent terms and confirm these answers are accurate.').check();
  await page.getByRole('button',{name:'Submit application',exact:true}).click();
  await page.getByRole('heading',{name:`We have your ${roleName.toLowerCase()} profile`,exact:true}).waitFor();
  await page.getByRole('button',{name:'Apply for another role',exact:true}).click();
  assert.equal(await page.getByRole('radio',{name:new RegExp('^'+roleName)}).isDisabled(),true);
  const anotherRole=roleName==='Tutor'?'Rider':'Tutor';
  assert.equal(await page.getByRole('radio',{name:new RegExp('^'+anotherRole)}).isEnabled(),true);
  failContext=true;
  await page.reload();
  await page.getByRole('heading',{name:'Exclusive onboarding unavailable'}).waitFor();
  failContext=false;
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await page.getByRole('radio',{name:new RegExp('^'+anotherRole)}).waitFor();
  results.checks.push(`${roleName}: four-step application, correct role payload and category, role-specific fields, review, success, another role and error recovery at ${width}px`);
  await context.close();
 }
 enabled=false;
 const closed=await fetch(origin+'/exclusive');assert.equal(closed.status,404);
 results.checks.push('Disabled shared campaign returns HTTP 404 before login');
 assert.equal(results.submissions.length,3);assert.deepEqual(results.pageErrors,[]);
 fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({...results,output}));
} catch(error){fs.writeFileSync(path.join(output,'failure.txt'),error.stack??String(error)); const page=browser?.contexts()[0]?.pages()[0]; if(page){fs.writeFileSync(path.join(output,'failure.html'),await page.content());await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});}throw error;}
finally{if(browser)await browser.close();server.kill('SIGTERM');api.close();fs.closeSync(log);}
