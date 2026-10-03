import {deliverCommunityPush} from '../services/community-push';
import {Hono} from 'hono';
import {sql} from 'drizzle-orm';
import {z} from '@kampusone/contracts';
import {database,firstRow,sqlClient} from '../lib/database';
import {id,input} from '../lib/input';
import {AppError} from '../lib/errors';
import {currentUser,requireAuth} from '../middleware/auth';
import type {Bindings,Variables} from '../types';
export const studentGroupRoutes=new Hono<{Bindings:Bindings;Variables:Variables}>();
studentGroupRoutes.use('/*',requireAuth);
type Group={id:string;institution_id:string;owner_user_id:string;kind:string;name:string;description:string;keywords:string[];joined_at:string|null;member_role:string|null};
async function access(c:any,membership=false){
 const u=currentUser(c),target=id(c.req.param('id'));
 const group=firstRow(await database(c.env).execute<Group>(sql`select g.*,m.joined_at,m.role member_role from public.student_groups g left join public.student_group_members m on m.group_id=g.id and m.user_id=${u.id}::uuid where g.id=${target}::uuid and g.institution_id=${u.universityId}::uuid`));
 if(!group)throw new AppError(404,'NOT_FOUND','Community not found.');
 if(membership&&!group.joined_at)throw new AppError(403,'FORBIDDEN','Join this group to see its posts and study insights.');
 return {u,group};
}
studentGroupRoutes.post('/',async c=>{
 const u=currentUser(c);if(!u.universityId)throw new AppError(409,'CONFLICT','Choose your university first.');
 const d=await input(c,z.object({kind:z.enum(['COMMUNITY','STUDY_GROUP']),name:z.string().trim().min(3).max(100),description:z.string().trim().max(1000).default(''),keywords:z.array(z.string().trim().min(1).max(40)).max(12).default([]),requestId:z.string().uuid()}).strict());
 const client=sqlClient(c.env);
 const results=await client.transaction([
  client`select pg_advisory_xact_lock(hashtextextended(${u.id+'-groups'},0))`,
  client`insert into public.student_groups(institution_id,owner_user_id,kind,name,description,keywords,request_id) select ${u.universityId}::uuid,${u.id}::uuid,${d.kind},${d.name},${d.description},${d.keywords}::text[],${d.requestId}::uuid where (select count(*) from public.student_groups where owner_user_id=${u.id}::uuid)<20 on conflict(owner_user_id,request_id) do nothing returning id`,
  client`insert into public.student_group_members(group_id,institution_id,user_id,role) select id,institution_id,${u.id}::uuid,'ADMIN' from public.student_groups where owner_user_id=${u.id}::uuid and request_id=${d.requestId}::uuid on conflict do nothing`,
  client`select id,kind,name,description,keywords from public.student_groups where owner_user_id=${u.id}::uuid and request_id=${d.requestId}::uuid`,
 ]);
 const group=results[3]?.[0];if(!group)throw new AppError(409,'CONFLICT','You can create up to 20 communities and study groups.');if(group.kind!==d.kind||group.name!==d.name||group.description!==d.description||JSON.stringify(group.keywords)!==JSON.stringify(d.keywords))throw new AppError(409,'CONFLICT','This create request belongs to a different group. Start a new request.');
 return c.json({group},results[1]?.length?201:200);
});
studentGroupRoutes.get('/:id',async c=>{
 const {u,group}=await access(c);
 const counts=firstRow(await database(c.env).execute(sql`select count(*)::int members from public.student_group_members where group_id=${group.id}::uuid`));
 return c.json({group:{...group,...counts},canPost:!!group.joined_at&&(group.kind==='STUDY_GROUP'||group.member_role==='ADMIN')});
});
studentGroupRoutes.post('/:id/join',async c=>{
 const {u,group}=await access(c);
 await database(c.env).execute(sql`insert into public.student_group_members(group_id,institution_id,user_id) values(${group.id}::uuid,${u.universityId}::uuid,${u.id}::uuid) on conflict do nothing`);
 return c.json({status:'joined'});
});
studentGroupRoutes.delete('/:id/join',async c=>{
 const {u,group}=await access(c,true);if(group.owner_user_id===u.id)throw new AppError(409,'CONFLICT','The creator must remain in the group.');
 const client=sqlClient(c.env);await client.transaction([
  client`update public.student_group_study_sessions set ended_at=least(now(),started_at+interval '12 hours') where group_id=${group.id}::uuid and user_id=${u.id}::uuid and ended_at is null`,
  client`delete from public.student_group_members where group_id=${group.id}::uuid and user_id=${u.id}::uuid`,
 ]);return c.json({status:'left'});
});
studentGroupRoutes.post('/:id/members',async c=>{
 const {u,group}=await access(c,true);if(group.member_role!=='ADMIN')throw new AppError(403,'FORBIDDEN','Only community admins can add members.');
 const d=await input(c,z.object({username:z.string().trim().min(3).max(30)}).strict());
 const added=firstRow(await database(c.env).execute(sql`insert into public.student_group_members(group_id,institution_id,user_id) select ${group.id}::uuid,${u.universityId}::uuid,p.user_id from public.profiles p where p.university_id=${u.universityId}::uuid and lower(p.username)=lower(${d.username.replace(/^@/,'')}) on conflict do nothing returning user_id`));
 if(!added)throw new AppError(409,'CONFLICT','That student is already a member, or their username was not found at your university.');return c.json({status:'added'},201);
});
studentGroupRoutes.get('/:id/posts',async c=>{
 const {u,group}=await access(c,true);
 const rows=await database(c.env).execute(sql`select p.*,pr.display_name,pr.username,to_jsonb(pr)->>'avatar_url' avatar_url,(select count(*)::int from public.student_group_comments where post_id=p.id) comment_count,(select option_index from public.student_group_votes where post_id=p.id and user_id=${u.id}::uuid) my_vote,coalesce((select jsonb_agg(jsonb_build_object('index',v.option_index,'count',v.n)) from(select option_index,count(*)::int n from public.student_group_votes where post_id=p.id group by option_index)v),'[]'::jsonb) votes from public.student_group_posts p join public.profiles pr on pr.user_id=p.author_user_id where p.group_id=${group.id}::uuid and p.institution_id=${u.universityId}::uuid order by p.created_at desc,p.id desc limit 100`);
 return c.json({posts:rows.rows});
});
studentGroupRoutes.post('/:id/posts',async c=>{
 const {u,group}=await access(c,true);if(group.kind!=='STUDY_GROUP'&&group.member_role!=='ADMIN')throw new AppError(403,'FORBIDDEN','Only community admins can publish updates.');
 const d=await input(c,z.object({title:z.string().trim().min(1).max(140),body:z.string().trim().min(1).max(5000),urgent:z.boolean().default(false),venue:z.string().trim().max(180).optional(),pollOptions:z.array(z.string().trim().min(1).max(100)).max(6).default([]),requestId:z.string().uuid()}).strict());
 if(d.pollOptions.length===1||new Set(d.pollOptions.map(v=>v.toLowerCase())).size!==d.pollOptions.length)throw new AppError(400,'BAD_REQUEST','A poll needs 2 to 6 different options.');
 if(d.urgent&&group.member_role!=='ADMIN')throw new AppError(403,'FORBIDDEN','Only an admin can send urgent alerts.');
 const post=firstRow(await database(c.env).execute(sql`insert into public.student_group_posts(group_id,institution_id,author_user_id,request_id,title,body,urgent,venue,poll_options) values(${group.id}::uuid,${u.universityId}::uuid,${u.id}::uuid,${d.requestId}::uuid,${d.title},${d.body},${d.urgent},${d.venue??null},${JSON.stringify(d.pollOptions)}::jsonb) on conflict(author_user_id,request_id) do update set request_id=excluded.request_id where student_group_posts.group_id=excluded.group_id and student_group_posts.title=excluded.title and student_group_posts.body=excluded.body and student_group_posts.poll_options=excluded.poll_options and student_group_posts.urgent=excluded.urgent and student_group_posts.venue is not distinct from excluded.venue returning id`));
 if(!post)throw new AppError(409,'CONFLICT','This save request belongs to a different post. Start a new draft.');try{c.executionCtx.waitUntil(deliverCommunityPush(c.env).catch(()=>undefined));}catch{/* Cron drains queued delivery outside Worker runtimes. */}return c.json({post},201);
});
studentGroupRoutes.get('/:id/posts/:postId/comments',async c=>{
 const {u,group}=await access(c,true);
 const rows=await database(c.env).execute(sql`select c.id,c.body,c.created_at,c.author_user_id,p.display_name,p.username,to_jsonb(p)->>'avatar_url' avatar_url from public.student_group_comments c join public.profiles p on p.user_id=c.author_user_id where c.group_id=${group.id}::uuid and c.post_id=${id(c.req.param('postId'))}::uuid and c.institution_id=${u.universityId}::uuid order by c.created_at,c.id limit 200`);return c.json({comments:rows.rows});
});
studentGroupRoutes.post('/:id/posts/:postId/comments',async c=>{
 const {u,group}=await access(c,true);const d=await input(c,z.object({body:z.string().trim().min(1).max(2000)}).strict());
 const comment=firstRow(await database(c.env).execute(sql`insert into public.student_group_comments(post_id,group_id,institution_id,author_user_id,body) select id,group_id,institution_id,${u.id}::uuid,${d.body} from public.student_group_posts where id=${id(c.req.param('postId'))}::uuid and group_id=${group.id}::uuid and institution_id=${u.universityId}::uuid returning id`));if(!comment)throw new AppError(404,'NOT_FOUND','Post not found.');return c.json({comment},201);
});
studentGroupRoutes.delete('/:id/posts/:postId/comments/:commentId',async c=>{
 const {u,group}=await access(c,true);const result=await database(c.env).execute(sql`delete from public.student_group_comments where id=${id(c.req.param('commentId'))}::uuid and post_id=${id(c.req.param('postId'))}::uuid and group_id=${group.id}::uuid and author_user_id=${u.id}::uuid returning id`);if(!firstRow(result))throw new AppError(404,'NOT_FOUND','Your comment was not found.');return c.json({deleted:true});
});
studentGroupRoutes.post('/:id/posts/:postId/vote',async c=>{
 const {u,group}=await access(c,true);const d=await input(c,z.object({optionIndex:z.number().int().min(0).max(5)}).strict());
 const vote=firstRow(await database(c.env).execute(sql`insert into public.student_group_votes(post_id,group_id,institution_id,user_id,option_index) select id,group_id,institution_id,${u.id}::uuid,${d.optionIndex} from public.student_group_posts where id=${id(c.req.param('postId'))}::uuid and group_id=${group.id}::uuid and jsonb_array_length(poll_options)>${d.optionIndex} on conflict(post_id,user_id) do update set option_index=excluded.option_index returning option_index`));if(!vote)throw new AppError(404,'NOT_FOUND','Poll not found.');return c.json({vote});
});
studentGroupRoutes.get('/:id/study',async c=>{
 const {u,group}=await access(c,true);if(group.kind!=='STUDY_GROUP')throw new AppError(409,'CONFLICT','Study tracking is available in study groups.');
 const client=sqlClient(c.env);await client`update public.student_group_study_sessions set ended_at=started_at+interval '12 hours' where group_id=${group.id}::uuid and ended_at is null and started_at<now()-interval '12 hours'`;
 const [active,members,days]=await Promise.all([
  database(c.env).execute(sql`select id,started_at from public.student_group_study_sessions where user_id=${u.id}::uuid and group_id=${group.id}::uuid and ended_at is null`),
  database(c.env).execute(sql`select m.user_id,p.display_name,p.username,coalesce(sum(greatest(0,extract(epoch from(s.ended_at-greatest(s.started_at,date_trunc('day',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'))))),0)::int today_seconds,coalesce(sum(greatest(0,extract(epoch from(s.ended_at-greatest(s.started_at,date_trunc('week',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'))))),0)::int week_seconds,coalesce(sum(greatest(0,extract(epoch from(s.ended_at-greatest(s.started_at,date_trunc('month',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'))))),0)::int month_seconds,exists(select 1 from public.student_group_study_sessions a where a.group_id=m.group_id and a.user_id=m.user_id and a.ended_at is null) studying_now from public.student_group_members m join public.profiles p on p.user_id=m.user_id left join public.student_group_study_sessions s on s.group_id=m.group_id and s.user_id=m.user_id and s.ended_at is not null where m.group_id=${group.id}::uuid group by m.user_id,p.display_name,p.username,m.group_id order by week_seconds desc,p.display_name`),
  database(c.env).execute(sql`select s.user_id,p.display_name,to_char(d.day_start at time zone 'Africa/Lagos','YYYY-MM-DD') as "day",sum(extract(epoch from(least(s.ended_at,d.day_start+interval '1 day')-greatest(s.started_at,d.day_start))))::int seconds from public.student_group_study_sessions s join public.profiles p on p.user_id=s.user_id join public.student_group_members m on m.group_id=s.group_id and m.user_id=s.user_id cross join lateral generate_series(date_trunc('day',s.started_at at time zone 'Africa/Lagos') at time zone 'Africa/Lagos',date_trunc('day',s.ended_at at time zone 'Africa/Lagos') at time zone 'Africa/Lagos',interval '1 day') d(day_start) where s.group_id=${group.id}::uuid and s.ended_at is not null and s.started_at>=now()-interval '90 days' and least(s.ended_at,d.day_start+interval '1 day')>greatest(s.started_at,d.day_start) group by s.user_id,p.display_name,d.day_start order by "day" desc,seconds desc limit 1000`),
 ]);return c.json({active:firstRow(active)??null,members:members.rows,days:days.rows});
});
studentGroupRoutes.post('/:id/study/start',async c=>{
 const {u,group}=await access(c,true);if(group.kind!=='STUDY_GROUP')throw new AppError(409,'CONFLICT','Choose a study group.');const d=await input(c,z.object({requestId:z.string().uuid()}).strict());
 const client=sqlClient(c.env);const rows=await client.transaction([
  client`select pg_advisory_xact_lock(hashtextextended(${u.id+'-study'},0))`,
  client`update public.student_group_study_sessions set ended_at=started_at+interval '12 hours' where user_id=${u.id}::uuid and ended_at is null and started_at<now()-interval '12 hours'`,
  client`insert into public.student_group_study_sessions(group_id,institution_id,user_id,request_id) select ${group.id}::uuid,${u.universityId}::uuid,${u.id}::uuid,${d.requestId}::uuid where not exists(select 1 from public.student_group_study_sessions where user_id=${u.id}::uuid and ended_at is null) on conflict(user_id,request_id) do nothing`,
  client`select id,group_id,started_at,ended_at from public.student_group_study_sessions where user_id=${u.id}::uuid and (ended_at is null or request_id=${d.requestId}::uuid) order by ended_at nulls first limit 1`,
 ]);const session=rows[3]?.[0];if(!session||session.group_id!==group.id)throw new AppError(409,'CONFLICT','Stop the active session in your other study group first.');if(session.ended_at)throw new AppError(409,'CONFLICT','This session has already ended. Start a new session.');return c.json({active:session},201);
});
studentGroupRoutes.post('/:id/study/stop',async c=>{
 const {u,group}=await access(c,true);const d=await input(c,z.object({sessionId:z.string().uuid()}).strict());
 const session=firstRow(await database(c.env).execute(sql`update public.student_group_study_sessions set ended_at=coalesce(ended_at,least(now(),started_at+interval '12 hours')) where id=${d.sessionId}::uuid and user_id=${u.id}::uuid and group_id=${group.id}::uuid returning id,started_at,ended_at,extract(epoch from(ended_at-started_at))::int seconds`));if(!session)throw new AppError(404,'NOT_FOUND','Study session not found.');return c.json({session});
});
