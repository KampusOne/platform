import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {october6Database} from './helpers/oct6-database';
import {testDatabaseAdapter,testSqlClient} from './helpers/database';
import {randomUUID} from 'node:crypto';
import {Hono,type Context,type Next} from 'hono';
import {aiRoutes} from '../src/routes/ai';
import {websiteRoutes} from '../src/routes/website';
import {AppError} from '../src/lib/errors';
import type {Bindings} from '../src/types';
let currentDb:PGlite;
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(currentDb),sqlClient:()=>testSqlClient(currentDb),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
vi.mock('../src/middleware/auth',()=>({currentUser:(c:Context)=>({id:c.req.header('x-user'),universityId:c.req.header('x-campus'),email:'fixture@example.test',roles:['STUDENT']}),requireAuth:async(c:Context,n:Next)=>c.req.header('x-user')?n():c.json({error:'Unauthorized'},401)}));

describe('October 6 release against the current complete database schema',()=>{
  let db:PGlite;
  const uni='11111111-1111-4111-8111-111111111111', otherUni='11111111-1111-4111-8111-111111111112';
  const admin='22222222-2222-4222-8222-222222222221', student='22222222-2222-4222-8222-222222222222', outsider='22222222-2222-4222-8222-222222222223';
  const profile='33333333-3333-4333-8333-333333333331', plan='33333333-3333-4333-8333-333333333332';
  beforeAll(async()=>{
    db=await october6Database();
    currentDb=db;
    for(const [id,name] of [[uni,'Fixture University'],[otherUni,'Other University']])await db.query('insert into public.universities(id,name,slug,updated_at) values($1::uuid,$2,$1::text,now())',[id,name]);
    for(const [id,name,campus] of [[admin,'Community Admin',uni],[student,'Student Test',uni],[outsider,'Outside Student',otherUni]]){
      await db.query("insert into public.users(id,email,password_hash,updated_at,email_verified_at) values($1::uuid,$1::text||'@example.test','fixture-only',now(),now())",[id]);
      await db.query('insert into public.profiles(id,user_id,username,display_name,university_id,updated_at) values($1,$1,$2,$3,$4,now())',[id,'fixture_'+id!.slice(-4),name,campus]);
    }
    await db.query(`insert into app_private.payment_fee_profiles(id,university_id,version,transaction_class,collection,effective_from,status,source_url,approval_note,approved_by)
      values($1,$2,'fixture-v1','LOCAL_COLLECTION','{"basisPoints":150,"flatKobo":10000,"flatWaivedBelowKobo":250000,"capKobo":200000}',now()-interval '1 day','APPROVED','https://paystack.com/pricing','Fixture approved provider rules',$3)`,[profile,uni,admin]);
    await db.query(`insert into app_private.kira_price_plans(id,university_id,version,collection,estimated_processing_kobo,approved_by,approval_note,source_url)
      values($1,$2,'fixture-pro','{"basisPoints":150,"flatKobo":10000,"flatWaivedBelowKobo":250000,"capKobo":200000}',19000,$3,'Fixture monthly Kira plan','https://paystack.com/pricing')`,[plan,uni,admin]);
    await db.query("insert into app_private.active_kira_price_plans(university_id,tier,plan_id)values($1,'pro',$2)",[uni,plan]);
  },90000);
  afterAll(async()=>{await db?.close();});
  afterEach(()=>vi.unstubAllGlobals());
  const http=new Hono().route('/ai',aiRoutes).route('/website',websiteRoutes);
  http.onError((error,c)=>c.json({error:error.message},error instanceof AppError?error.status:500));
  const env={ENVIRONMENT:'production',DATABASE_URL:'postgres://fixture.invalid/db',PHASE_3_SCHEMA_READY:'true',UNIFIED_SCHEMA_READY:'true',KIRA_SUBSCRIPTIONS_ENABLED:'true',PAYMENTS_ENABLED:'true',AI_ASSISTANT_ENABLED:'true',PAYSTACK_SECRET_KEY:'sk_live_fixture',HF_TOKEN:'synthetic',HF_CHAT_MODEL:'synthetic/standard',HF_PRO_MODEL:'synthetic/pro'} as Bindings;
  const request=(path:string,method='GET',body?:unknown)=>http.request(path,{method,headers:{'x-user':student,'x-campus':uni,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},env);
  it('restores all current tables and applies the release migrations',async()=>{
    const tables=await db.query<{count:number}>('select count(*)::int from information_schema.tables where table_schema in (\'public\',\'app_private\')');
    expect(tables.rows[0]!.count).toBeGreaterThanOrEqual(207);
  });
  it('imports sourced footprints once, clips outside places and preserves reviewed directory locations',async()=>{
    const campus=randomUUID(),place=randomUUID();
    const boundary={type:'MultiPolygon',coordinates:[[[[5.61,6.39],[5.63,6.39],[5.63,6.41],[5.61,6.41],[5.61,6.39]]]]};
    await db.query("insert into public.institution_campuses(id,institution_id,name,slug,latitude,longitude,status,boundary)values($1,$2,'Map fixture','map-fixture',6.4,5.62,'PUBLISHED',ST_SetSRID(ST_GeomFromGeoJSON($3),4326))",[campus,uni,JSON.stringify(boundary)]);
    await db.query("insert into public.campus_places(id,university_id,campus_id,name,category,latitude,longitude,status)values($1,$2,$3,'Library','ACADEMIC',6.4,5.62,'PUBLISHED')",[place,uni,campus]);
    const building={type:'Polygon',coordinates:[[[5.62,6.4],[5.6201,6.4],[5.6201,6.4001],[5.62,6.4001],[5.62,6.4]]]};
    const features=[{geometry:building,properties:{kind:'building',sourceId:'overture-building-1'}},{geometry:{type:'Point',coordinates:[5.6201,6.4001]},properties:{kind:'place',name:'Library',sourceId:'overture-place-1'}},{geometry:{type:'Point',coordinates:[6,7]},properties:{kind:'place',name:'Outside place',sourceId:'outside'}}];
    const run=()=>db.query<{result:{newBuildings:number;newPlaceCandidates:number}}>("select app_private.import_overture_campus($1,$2,'2026-09-23.1',$3,$4::jsonb)result",[campus,admin,'f'.repeat(64),JSON.stringify(features)]);
    expect((await run()).rows[0]!.result).toMatchObject({newBuildings:1,newPlaceCandidates:1});
    expect((await run()).rows[0]!.result).toMatchObject({newBuildings:0,newPlaceCandidates:0});
    expect((await db.query<{latitude:string;longitude:string}>('select latitude::text,longitude::text from public.campus_places where id=$1',[place])).rows[0]).toEqual({latitude:'6.400000',longitude:'5.620000'});
    expect((await db.query<{source_provider:string;matched_place_id:string}>('select source_provider,matched_place_id from app_private.map_candidates where campus_id=$1',[campus])).rows).toEqual([{source_provider:'OVERTURE',matched_place_id:place}]);
    expect((await db.query<{source_provider:string}>('select source_provider from app_private.map_imports where campus_id=$1',[campus])).rows).toEqual([{source_provider:'OVERTURE'}]);
  });
  it('opens production checkout once without an account attestation and sends the exact principal to Paystack',async()=>{
    expect((await db.query('select * from app_private.paystack_account_reviews')).rows).toHaveLength(0);
    const quoted=await request('/ai/subscription-quote','POST',{tier:'pro'});
    expect(quoted.status,await quoted.clone().text()).toBe(200);
    const q=(await quoted.json() as any).quote;
    const saved=(await db.query<any>('select * from app_private.kira_subscription_quotes where id=$1',[q.quoteId])).rows[0];
    const principal=Number(saved.amount_kobo)-Number(saved.estimated_processing_kobo);
    const provider=vi.fn(async(_url:string,init:RequestInit)=>{
      const input=JSON.parse(String(init.body));expect(input.amount).toBe(principal);
      return Response.json({status:true,data:{authorization_url:'https://checkout.paystack.com/fixture',access_code:'fixture',reference:input.reference}});
    });vi.stubGlobal('fetch',provider);
    const body={requestId:randomUUID(),consent:true,tier:'pro',quoteId:q.quoteId,expectedAmountKobo:q.amountKobo};
    const opened=await request('/ai/subscription-checkout','POST',body);
    expect(opened.status,await opened.clone().text()).toBe(200);
    expect((await request('/ai/subscription-checkout','POST',body)).status).toBe(200);
    expect(provider).toHaveBeenCalledOnce();
    const snapshot=(await db.query<any>('select * from app_private.collection_payment_pricing where resource_id in(select id from app_private.kira_checkouts where quote_id=$1)',[q.quoteId])).rows[0];
    expect(snapshot.provider_fee_mode).toBe('CUSTOMER_PASSTHROUGH');expect(Number(snapshot.provider_initialized_amount_kobo)).toBe(principal);
  });
  it('makes waitlist shutdown a real 404 and keeps repeated article likes and joins idempotent',async()=>{
    const join={email:'waitlist-fixture@example.test',fullName:'Fixture Person',universityName:'Fixture University',platform:'ANDROID',contactConsent:true};
    expect((await request('/website/waitlist','POST',join)).status).toBe(202);
    expect((await request('/website/waitlist','POST',join)).status).toBe(202);
    expect((await db.query("select id from app_private.website_waitlist where email='waitlist-fixture@example.test'")).rows).toHaveLength(1);
    await db.exec('update app_private.website_settings set waitlist_enabled=false');
    expect((await request('/website/waitlist')).status).toBe(404);expect((await request('/website/waitlist','POST',join)).status).toBe(404);
    const like='/website/articles/campus-life-should-feel-connected/like';
    for(let i=0;i<2;i++){const response=await request(like,'PUT',{liked:true});expect(response.status,await response.clone().text()).toBe(200);}
    expect((await db.query('select * from app_private.website_article_likes')).rows).toHaveLength(1);
    expect((await request(like,'PUT',{liked:false})).status).toBe(200);expect((await db.query('select * from app_private.website_article_likes')).rows).toHaveLength(0);
    await db.exec('update app_private.website_settings set waitlist_enabled=true');
  });
  it('switches only subsequent tutorial uploads to Bunny and cannot replay another tutor’s upload',async()=>{
    const tutor=randomUUID(),application=randomUUID();await db.query("insert into public.agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,'TUTOR','Fixture Tutor','+2348000000000','Synthetic tutorial application')",[application,admin,uni]);await db.query("insert into public.agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,status,verified_at)values($1,$2,$3,$4,'TUTOR','Fixture Tutor','ACTIVE',now())",[tutor,admin,uni,application]);
    await db.exec('update app_private.tutorial_storage_controls set bunny_after=1');
    const first=randomUUID(),second=randomUUID();
    const reserve=(id:string,bunny:boolean,user=admin)=>db.query<any>("select * from app_private.reserve_tutorial_video($1,$2,$3,'Tutorial.mp4','video/mp4',1000,$4)",[id,user,uni,bunny]);
    expect((await reserve(first,false)).rows[0].provider).toBe('R2');
    await expect(reserve(second,false)).rejects.toThrow('VIDEO_BUNNY_REQUIRED');
    expect((await reserve(second,true)).rows[0].provider).toBe('BUNNY');expect((await reserve(first,true)).rows[0].provider).toBe('R2');
    await expect(reserve(first,true,student)).rejects.toThrow('VIDEO_TUTOR_FORBIDDEN');
    await db.query('update app_private.tutorial_video_assets set expires_at=now()-interval \'1 minute\' where id=$1',[first]);
    await expect(reserve(first,true)).rejects.toThrow('VIDEO_UPLOAD_EXPIRED');
    await db.exec('update app_private.tutorial_storage_controls set bunny_after=25');
  });
  async function snapshot(reference:string,resourceId:string,mode='CUSTOMER_PASSTHROUGH'){
    await db.query(`insert into app_private.collection_payment_pricing(provider_reference,university_id,purpose,resource_id,provider_fee_mode,
      provider_initialized_amount_kobo,final_customer_amount_kobo,expected_provider_fee_kobo,collection,fee_profile_id,fee_profile_version,variance_tolerance_kobo,native_pricing)
      values($1,$2,'KIRA_SUBSCRIPTION',$3,$4,$5,600000,19000,'{"basisPoints":150,"flatKobo":10000,"flatWaivedBelowKobo":250000,"capKobo":200000}',$6,'fixture-v1',100,'{}')`,[reference,uni,resourceId,mode,mode==='CUSTOMER_PASSTHROUGH'?581000:600000,profile]);
  }
  async function observe(reference:string,gross=600000,fee=19000,requested:number|null=581000,transaction=randomUUID().replaceAll('-','')){
    return (await db.query<{state:string}>("select app_private.record_collection_pricing_observation_v2($1,$2,$3,$4,'card','NG','VISA','NGN','test',$5) state",[reference,gross,fee,transaction,requested])).rows[0]!.state;
  }
  it('holds an incorrect subtotal or requested amount and never accepts arbitrary overpayment',async()=>{
    const ref='K1-AI-wrong-subtotal';await snapshot(ref,randomUUID());
    expect(await observe(ref,600001)).toBe('REQUIRES_REVIEW');
    expect((await db.query<{match:boolean}>('select app_private.collection_paid_price_matches($1,600001,19000,600000) match',[ref])).rows[0]!.match).toBe(false);
    const ref2='K1-AI-wrong-requested';await snapshot(ref2,randomUUID());
    expect(await observe(ref2,600000,19000,580999)).toBe('REQUIRES_REVIEW');
    expect((await db.query<{count:number}>("select count(*)::int from public.ledger_transactions")).rows[0]!.count).toBe(0);
  });
  it('reconciles duplicate receipts and a delayed Kira webhook once with balanced principal journals',async()=>{
    const ref='K1-AI-late-paid', checkout=randomUUID();await snapshot(ref,checkout);
    await db.query(`insert into app_private.kira_checkouts(id,user_id,university_id,plan_id,request_id,provider_reference,created_at,expires_at,status)
      values($1,$2,$3,$4,$5,$6,now()-interval '3 hours',now()-interval '2 hours','EXPIRED')`,[checkout,student,uni,plan,randomUUID(),ref]);
    expect(await observe(ref,600000,19000,581000,'90001')).toBe('OBSERVED');
    expect(await observe(ref,600000,19000,581000,'90001')).toBe('ALREADY_OBSERVED');
    const paid="select app_private.record_kira_receipt($1,600000,19000,now()-interval '150 minutes') state";
    expect((await db.query<{state:string}>(paid,[ref])).rows[0]!.state).toBe('PAID');
    expect((await db.query<{state:string}>(paid,[ref])).rows[0]!.state).toBe('ALREADY_PAID');
    const journals=(await db.query<{idempotency_key:string;journal_payload:{lines:{code:string;direction:string;amount:number}[]}}>('select idempotency_key,journal_payload from public.ledger_transactions')).rows;
    expect(journals.filter(j=>j.idempotency_key==='provider-processing-recovery:'+ref)).toHaveLength(1);
    const balances=new Map<string,number>();
    for(const journal of journals){
      let debit=0,credit=0;
      for(const line of journal.journal_payload.lines){
        const amount=Number(line.amount);if(line.direction==='DEBIT')debit+=amount;else credit+=amount;
        balances.set(line.code,(balances.get(line.code)??0)+(line.direction==='DEBIT'?amount:-amount));
      }
      expect(debit).toBe(credit);
    }
    expect(balances.get('PAYMENT_SUSPENSE')).toBe(0);
    expect(balances.get('PROCESSING_EXPENSE')).toBe(0);
    expect(balances.get('PAYSTACK_CLEARING')).toBe(581000);
    expect(balances.get('KIRA_SUBSCRIPTION_REVENUE')).toBe(-581000);
    expect((await db.query('select * from app_private.kira_billing_periods where checkout_id=$1',[checkout])).rows).toHaveLength(1);
    const refund=(await db.query<{snapshot:{receipt:{amount_kobo:number};allocation:{lines:{code:string;amount:number}[]}}}>('select app_private.refund_original_snapshot($1) snapshot',[ref])).rows[0]!.snapshot;
    expect(Number(refund.receipt.amount_kobo)).toBe(600000);
    expect(Number(refund.allocation.lines.find(l=>l.code==='PAYMENT_SUSPENSE')!.amount)).toBe(581000);
  });
  it('preserves the exact amount of historical inclusive receipts',async()=>{
    const ref='K1-AI-legacy';await snapshot(ref,randomUUID(),'LEGACY_INCLUSIVE');
    expect(await observe(ref,600000,19000,600000,'90002')).toBe('OBSERVED');
    expect((await db.query<{principal:number}>('select app_private.collection_settlement_principal($1,600000,19000) principal',[ref])).rows[0]!.principal.toString()).toBe('600000');
  });
  it('creates only first-paper alarms in Lagos time and disables one day only after a valid owner code',async()=>{
    const day=(await db.query<{date:string}>("select ((now() at time zone 'Africa/Lagos')::date+20)::text date")).rows[0]!.date;
    const next=(await db.query<{date:string}>('select ($1::date+1)::text date',[day])).rows[0]!.date;
    const entries=[
      {title:'First paper',courseCode:'CSC 201',date:day,startsAt:'09:00',endsAt:'11:00',venue:'Hall A'},
      {title:'Later paper',courseCode:'MTH 201',date:day,startsAt:'14:00',endsAt:'16:00',venue:'Hall B'},
      {title:'Next day paper',courseCode:'PHY 201',date:next,startsAt:'12:00',endsAt:'14:00',venue:'Hall C'},
    ],request=randomUUID();
    const imported=()=>db.query<{imported:number;replayed:boolean}>('select * from app_private.import_exam_schedule($1,$2,$3,$4,$5::jsonb)',[student,uni,request,'fixture-exam-hash',JSON.stringify(entries)]);
    expect((await imported()).rows).toEqual([{imported:3,replayed:false}]);
    const alarms=(await db.query<{id:string;exam_date:string;course_code:string;lead_minutes:number;fires_at:Date}>("select a.id,e.exam_date::text,e.course_code,l.lead_minutes,a.fires_at from public.student_alarms a join app_private.exam_alarm_links l on l.alarm_id=a.id join public.student_exams e on e.id=l.exam_id where e.user_id=$1 order by a.fires_at",[student])).rows;
    expect(alarms).toHaveLength(8);expect(alarms.filter(a=>a.course_code==='MTH 201')).toHaveLength(0);
    expect(new Date(alarms[0]!.fires_at).toISOString()).toBe(day+'T06:00:00.000Z');
    expect(alarms.slice(0,4).map(a=>a.lead_minutes)).toEqual([120,60,30,15]);
    expect((await imported()).rows).toEqual([{imported:3,replayed:true}]);
    expect((await db.query('select alarm_id from app_private.exam_alarm_links order by alarm_id')).rows.map(a=>a.alarm_id)).toEqual(alarms.map(a=>a.id).sort());
    const challenge=randomUUID();await db.query("insert into app_private.exam_disable_challenges(id,user_id,exam_date,code_hash,expires_at) values($1,$2,$3,'right-code',now()+interval '10 minutes')",[challenge,student,day]);
    const confirm=async(user:string,hash:string)=>(await db.query<{state:string}>('select app_private.confirm_exam_awareness($1,$2,$3) state',[user,challenge,hash])).rows[0]!.state;
    expect(await confirm(outsider,'right-code')).toBe('EXPIRED');expect(await confirm(student,'wrong-code')).toBe('INCORRECT');
    expect((await db.query<{count:number}>('select count(*)::int count from public.student_alarms where user_id=$1 and enabled',[student])).rows[0]!.count).toBe(8);
    expect(await confirm(student,'right-code')).toBe('CONFIRMED');expect(await confirm(student,'right-code')).toBe('ALREADY_CONFIRMED');
    expect((await db.query<{enabled:boolean;exam_date:string}>('select a.enabled,e.exam_date::text from public.student_alarms a join app_private.exam_alarm_links l on l.alarm_id=a.id join public.student_exams e on e.id=l.exam_id where e.user_id=$1',[student])).rows.every(a=>a.enabled===(a.exam_date===next))).toBe(true);
    const expired=randomUUID();await db.query("insert into app_private.exam_disable_challenges(id,user_id,exam_date,code_hash,expires_at)values($1,$2,$3,'right',now()+interval '10 minutes')",[expired,student,next]);
    for(let i=0;i<5;i++)expect((await db.query<{state:string}>("select app_private.confirm_exam_awareness($1,$2,'wrong') state",[student,expired])).rows[0]!.state).toBe('INCORRECT');
    expect((await db.query<{state:string}>("select app_private.confirm_exam_awareness($1,$2,'right') state",[student,expired])).rows[0]!.state).toBe('EXPIRED');
  });
  it('does not grant community access until an authorized admin approves a request in its campus',async()=>{
    const group=randomUUID(), request=randomUUID(), foreignRequest=randomUUID();
    await db.query("insert into public.student_groups(id,institution_id,owner_user_id,kind,name,request_id) values($1,$2,$3,'COMMUNITY','Test community',$4)",[group,uni,admin,randomUUID()]);
    await db.query("insert into public.student_group_members(group_id,institution_id,user_id,role) values($1,$2,$3,'ADMIN')",[group,uni,admin]);
    for(const [id,user] of [[request,student],[foreignRequest,outsider]])await db.query(`insert into app_private.community_join_requests(id,group_id,institution_id,user_id,full_name,matriculation_number,department,level,nickname,guidelines_version,guidelines_snapshot)
      values($1,$2,$3,$4,'Student Test','MAT/2026/001','Computer Science','200','Student',1,'Respect members')`,[id,group,uni,user]);
    expect((await db.query('select * from public.student_group_members where group_id=$1 and user_id=$2',[group,student])).rows).toHaveLength(0);
    await expect(db.query("select app_private.review_community_join_requests($1,$2,$3,'{}',true,'APPROVED')",[group,student,uni])).rejects.toThrow('JOIN_REVIEW_FORBIDDEN');
    const approved=(await db.query<{count:number}>("select app_private.review_community_join_requests($1,$2,$3,'{}',true,'APPROVED') count",[group,admin,uni])).rows[0]!.count;
    expect(approved).toBe(1);
    expect((await db.query<{nickname:string;notifications_enabled:boolean}>('select nickname,notifications_enabled from public.student_group_members where group_id=$1 and user_id=$2',[group,student])).rows[0]).toEqual({nickname:'Student',notifications_enabled:true});
    expect((await db.query<{status:string}>('select status from app_private.community_join_requests where id=$1',[foreignRequest])).rows[0]!.status).toBe('PENDING');
  });
});
