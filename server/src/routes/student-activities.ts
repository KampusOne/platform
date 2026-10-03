import {Hono} from 'hono';
import {sql} from 'drizzle-orm';
import {z} from '@kampusone/contracts';
import {currentUser,requireAuth} from '../middleware/auth';
import {database,firstRow} from '../lib/database';
import {input} from '../lib/input';
import {AppError} from '../lib/errors';
import {sha256} from '../lib/security';
import {socialSchemaReady} from '../lib/feed-social';
import {notifyProfilePostPublished} from '../services/profile-post-notifications';
import {notifyPostMentions} from '../services/post-mentions';
import type {Bindings,Variables} from '../types';
const link=z.string().url().max(2000).refine(value=>['http:','https:'].includes(new URL(value).protocol),'Use an HTTP or HTTPS link.');
export const activitySchema=z.object({requestId:z.string().uuid(),category:z.enum(['EVENT','SPORTS','OPPORTUNITY']),title:z.string().trim().min(4).max(180),description:z.string().trim().min(1).max(5000),venue:z.string().trim().max(200).optional(),startsAt:z.iso.datetime({offset:true}).optional(),deadline:z.iso.datetime({offset:true}).optional(),registrationUrl:link.optional(),mediaIds:z.array(z.string().uuid()).max(5).default([])}).strict().superRefine((data,ctx)=>{
 if(data.category!=='OPPORTUNITY'&&(!data.venue||!data.startsAt))ctx.addIssue({code:'custom',message:'Add the venue and start date/time.'});
 if(data.category==='OPPORTUNITY'&&(!data.deadline||!data.registrationUrl))ctx.addIssue({code:'custom',message:'Add the application link and deadline.'});
 if(new Set(data.mediaIds).size!==data.mediaIds.length)ctx.addIssue({code:'custom',message:'Choose each image once.'});
});
export const studentActivityRoutes=new Hono<{Bindings:Bindings,Variables:Variables}>();
studentActivityRoutes.post('/activity',requireAuth,async c=>{
 if(!await socialSchemaReady(c.env))throw new AppError(503,'PROVIDER_UNAVAILABLE','Campus publishing is temporarily unavailable. Your draft is kept.');
 const user=currentUser(c);
 if(!user.universityId)throw new AppError(409,'CONFLICT','Choose your university before publishing.');
 const data=await input(c,activitySchema),db=database(c.env),hash=await sha256(JSON.stringify(data));
 const previous=firstRow(await db.execute<{id:string;hash:string}>(sql`select id,audience->>'activityRequestHash' as hash from public.feed_posts where author_user_id=${user.id}::uuid and client_request_id=${data.requestId}::uuid`));
 if(previous){if(previous.hash!==hash)throw new AppError(409,'CONFLICT','This draft changed. Publish it with a new request reference.');await notifyProfilePostPublished(c.env,previous.id,user.id);await notifyPostMentions(c.env,previous.id,user.id);return c.json({id:previous.id},200);}
 const media=data.mediaIds.length?(await db.execute<{id:string;content_type:string}>(sql`select id,content_type from public.media_objects where id=any(${sql.param(data.mediaIds)}::uuid[]) and owner_user_id=${user.id}::uuid and kind='post' and deleted_at is null and content_type in('image/jpeg','image/png','image/webp')`)).rows:[];
 if(media.length!==data.mediaIds.length)throw new AppError(400,'BAD_REQUEST','Choose images uploaded from this account.');
 const allowed=firstRow(await db.execute<{allowed:boolean}>(sql`select app_private.consume_request_rate_limit('STUDENT_ACTIVITY',${user.id},10,3600,3600) as allowed`));
 if(!allowed?.allowed)throw new AppError(429,'RATE_LIMITED','You’ve published several updates. Please try again later.');
 const origin=(c.env.PUBLIC_API_ORIGIN??new URL(c.req.url).origin).replace(/\/$/,''),images=data.mediaIds.map(id=>({url:origin+'/v1/media/'+id,type:media.find(item=>item.id===id)!.content_type}));
 const activity={venue:data.venue??null,startsAt:data.startsAt??null,deadline:data.deadline??null,registrationUrl:data.registrationUrl??null};
 const audience=JSON.stringify({studentPost:true,visibility:'PUBLIC',media:images,mediaType:images[0]?.type??null,activity,activityRequestHash:hash});
 const post=firstRow(await db.execute<{id:string}>(sql`with source as(insert into public.content_sources(university_id,name,owner_user_id)values(${user.universityId}::uuid,${'student:'+user.id},${user.id}::uuid)on conflict(university_id,name)do update set owner_user_id=excluded.owner_user_id returning id)
 insert into public.feed_posts(university_id,source_id,author_user_id,category,title,summary,body,image_url,audience,status,published_at,client_request_id)
 select ${user.universityId}::uuid,id,${user.id}::uuid,${data.category},${data.title},${data.description.slice(0,500)},${data.description},${images[0]?.url??null},${audience}::jsonb,'PUBLISHED',now(),${data.requestId}::uuid from source
 on conflict(author_user_id,client_request_id)where client_request_id is not null do update set client_request_id=excluded.client_request_id where feed_posts.audience->>'activityRequestHash'=excluded.audience->>'activityRequestHash' returning id`));
 if(!post)throw new AppError(409,'CONFLICT','This request belongs to a different draft.');
 await notifyProfilePostPublished(c.env,post.id,user.id);await notifyPostMentions(c.env,post.id,user.id);
 return c.json(post,201);
});
