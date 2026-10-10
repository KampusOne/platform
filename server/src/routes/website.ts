import {cachedVersionedRead} from "../lib/cache-revision";
import {Hono,type Context} from 'hono';
import {sql} from 'drizzle-orm';
import {z} from '@kampusone/contracts';
import {database,firstRow} from '../lib/database';
import {currentUser,requireAuth} from '../middleware/auth';
import {resolveAdminScope} from '../lib/admin-access';
import {input} from '../lib/input';
import {AppError} from '../lib/errors';
import {sha256} from '../lib/security';
import {recordAudit} from '../lib/audit';
import type {Bindings,Variables} from '../types';
export const websiteRoutes=new Hono<{Bindings:Bindings;Variables:Variables}>();
type Settings={waitlist_enabled:boolean;ios_url:string;play_store_url:string};
async function settings(env:Bindings){return firstRow(await database(env).execute<Settings>(sql`select waitlist_enabled,ios_url,play_store_url from app_private.website_settings where singleton`))!;}
type AndroidRelease={sourceSha:string;versionName:string;versionCode:number;apkSha256:string;apkSizeBytes:number;objectKey:string;verifiedAt:string};
async function release(env:Bindings){const object=await env.MEDIA_BUCKET?.get('releases/android/latest.json');if(!object)return null;try{const data=await object.json<AndroidRelease>();if(!/^releases\/android\/[a-f0-9]{40}\.apk$/.test(data.objectKey)||!/^[a-f0-9]{64}$/.test(data.apkSha256)||!/^[a-f0-9]{40}$/.test(data.sourceSha)||data.objectKey!==`releases/android/${data.sourceSha}.apk`||!Number.isSafeInteger(data.apkSizeBytes))return null;return data;}catch{return null;}}
websiteRoutes.get('/config',async c=>{const [s,r]=await Promise.all([cachedVersionedRead(c,'website-settings','website.settings','public',60,()=>settings(c.env)),release(c.env)]);c.header('Cache-Control','public,max-age=15');return c.json({waitlistEnabled:s.waitlist_enabled,iosUrl:s.ios_url,playStoreUrl:s.play_store_url,android:r?{version:r.versionName,sizeBytes:r.apkSizeBytes,sha256:r.apkSha256,url:(c.env.PUBLIC_API_ORIGIN??new URL(c.req.url).origin)+'/v1/website/download/android'}:null});});
websiteRoutes.get('/waitlist',async c=>{if(!(await settings(c.env)).waitlist_enabled)throw new AppError(404,'NOT_FOUND','Not found.');c.header('Cache-Control','no-store');return c.json({enabled:true});});
websiteRoutes.post('/waitlist',async c=>{
 if(!(await settings(c.env)).waitlist_enabled)throw new AppError(404,'NOT_FOUND','Not found.');
 const d=await input(c,z.object({email:z.string().trim().toLowerCase().email().max(254),fullName:z.string().trim().min(2).max(120),universityName:z.string().trim().max(180).default(''),platform:z.enum(['ANDROID','IOS','BOTH']),contactConsent:z.literal(true),website:z.string().max(200).default('')}).strict());
 if(d.website)return c.json({status:'joined'},202);
 const key=await sha256(d.email),allowed=firstRow(await database(c.env).execute<{allowed:boolean}>(sql`select app_private.consume_request_rate_limit('WEBSITE_WAITLIST',${key},3,3600,3600)allowed`));
 if(!allowed?.allowed)throw new AppError(429,'RATE_LIMITED','Please wait before trying again.');
 await database(c.env).execute(sql`insert into app_private.website_waitlist(email,full_name,university_name,platform)values(${d.email},${d.fullName},${d.universityName},${d.platform})on conflict(email)do nothing`);return c.json({status:'joined'},202);
});
websiteRoutes.get('/download/android',async c=>{
 const r=await release(c.env);if(!r||!c.env.MEDIA_BUCKET)throw new AppError(404,'NOT_FOUND','The Android download is being prepared. Please check again shortly.');
 const object=await c.env.MEDIA_BUCKET.get(r.objectKey,{range:c.req.raw.headers});if(!object)throw new AppError(404,'NOT_FOUND','This Android download is unavailable.');
 const h=new Headers({'Content-Type':'application/vnd.android.package-archive','Content-Disposition':`attachment; filename="KampusOne-Android-${r.versionName.replace(/[^0-9a-z.-]/gi,'')}.apk"`,'Cache-Control':'public,max-age=60','ETag':object.httpEtag,'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'});let status=200;
 if(object.range&&'offset'in object.range){const offset=object.range.offset??0,length=object.range.length??object.size-offset;h.set('Content-Range',`bytes ${offset}-${offset+length-1}/${object.size}`);h.set('Content-Length',String(length));status=206;}else h.set('Content-Length',String(object.size));
 return new Response(object.body,{status,headers:h});
});
websiteRoutes.get('/articles',async c=>{
 const articles=await cachedVersionedRead(c,'website-articles','website.articles','published',30,async()=>
  (await database(c.env).execute(sql`select id,slug,title,excerpt,cover_url,author_name,published_at,(select count(*)::int from app_private.website_article_likes where article_id=a.id)likes from public.website_articles a where status='PUBLISHED' order by published_at desc,id limit 60`)).rows);
 // Publication revisions are checked on each request; browser/CDN snapshots
 // would otherwise keep an archived article visible after invalidation.
 c.header('Cache-Control','no-store');return c.json({articles});
});
websiteRoutes.get('/articles/:slug',async c=>{
 const slug=z.string().regex(/^[a-z0-9][a-z0-9-]{1,119}$/).safeParse(c.req.param('slug'));if(!slug.success)throw new AppError(404,'NOT_FOUND','Article not found.');
 const article=await cachedVersionedRead(c,'website-article','website.articles',slug.data,30,async()=>{
  const row=firstRow(await database(c.env).execute(sql`select id,slug,title,excerpt,body,cover_url,author_name,published_at,updated_at,(select count(*)::int from app_private.website_article_likes where article_id=a.id)likes from public.website_articles a where slug=${slug.data} and status='PUBLISHED'`));
  if(!row)throw new AppError(404,'NOT_FOUND','Article not found.');return row;
 });c.header('Cache-Control','no-store');return c.json({article});
});
websiteRoutes.put('/articles/:slug/like',requireAuth,async c=>{const user=currentUser(c),d=await input(c,z.object({liked:z.boolean()}).strict());const article=firstRow(await database(c.env).execute<{id:string}>(sql`select id from public.website_articles where slug=${c.req.param('slug')} and status='PUBLISHED'`));if(!article)throw new AppError(404,'NOT_FOUND','Article not found.');if(d.liked)await database(c.env).execute(sql`insert into app_private.website_article_likes(article_id,user_id)values(${article.id}::uuid,${user.id}::uuid)on conflict do nothing`);else await database(c.env).execute(sql`delete from app_private.website_article_likes where article_id=${article.id}::uuid and user_id=${user.id}::uuid`);const count=firstRow(await database(c.env).execute(sql`select count(*)::int likes from app_private.website_article_likes where article_id=${article.id}::uuid`));c.header('Cache-Control','private,no-store');return c.json({liked:d.liked,...count});});
websiteRoutes.get('/articles/:slug/like',requireAuth,async c=>{const u=currentUser(c),row=firstRow(await database(c.env).execute(sql`select exists(select 1 from app_private.website_article_likes l join public.website_articles a on a.id=l.article_id where a.slug=${c.req.param('slug')} and a.status='PUBLISHED'and l.user_id=${u.id}::uuid)liked`));c.header('Cache-Control','private,no-store');return c.json(row);});
async function globalAccess(c:Context<{Bindings:Bindings;Variables:Variables}>,permission:string){const scope=await resolveAdminScope(c.env,currentUser(c),undefined,permission);if(scope!==null)throw new AppError(403,'FORBIDDEN','The public website requires global content access.');}
websiteRoutes.use('/admin/*',requireAuth);
websiteRoutes.get('/admin/settings',async c=>{await globalAccess(c,'content.view');return c.json(await settings(c.env));});
const downloadUrl=z.string().trim().max(1500).refine(s=>!s||/^https:\/\/(?:testflight\.apple\.com|apps\.apple\.com|play\.google\.com)\//.test(s),'Use an official app store or TestFlight URL.');
websiteRoutes.put('/admin/settings',async c=>{await globalAccess(c,'content.manage');const d=await input(c,z.object({waitlistEnabled:z.boolean(),iosUrl:downloadUrl,playStoreUrl:downloadUrl}).strict());const u=currentUser(c);await database(c.env).execute(sql`update app_private.website_settings set waitlist_enabled=${d.waitlistEnabled},ios_url=${d.iosUrl},play_store_url=${d.playStoreUrl},updated_by=${u.id}::uuid,updated_at=now()where singleton`);await recordAudit(c.env,{actorUserId:u.id,action:'website.settings.updated',targetType:'website',targetId:'settings',requestId:c.get('requestId'),metadata:d});return c.json({saved:true});});
websiteRoutes.get('/admin/waitlist',async c=>{await globalAccess(c,'content.view');const rows=await database(c.env).execute(sql`select id,email,full_name,university_name,platform,created_at from app_private.website_waitlist order by created_at desc limit 500`),count=firstRow(await database(c.env).execute(sql`select count(*)::int total from app_private.website_waitlist`));c.header('Cache-Control','private,no-store');return c.json({entries:rows.rows,...count});});
websiteRoutes.get('/admin/articles',async c=>{await globalAccess(c,'content.view');return c.json({articles:(await database(c.env).execute(sql`select * from public.website_articles order by updated_at desc limit 100`)).rows});});
const articleDraft=z.object({id:z.string().uuid().optional(),revision:z.number().int().min(1).optional(),slug:z.string().regex(/^[a-z0-9][a-z0-9-]{1,119}$/),title:z.string().trim().min(3).max(180),excerpt:z.string().trim().max(600),body:z.string().trim().min(10).max(80000),coverUrl:z.string().trim().max(1500).refine(s=>!s||/^https:\/\//.test(s),'Use an HTTPS image URL.'),authorName:z.string().trim().min(2).max(120),status:z.enum(['DRAFT','PUBLISHED','ARCHIVED'])}).strict();
websiteRoutes.put('/admin/articles',async c=>{await globalAccess(c,'content.manage');const u=currentUser(c),d=await input(c,articleDraft),id=d.id??crypto.randomUUID();const r=firstRow(await database(c.env).execute(sql`insert into public.website_articles(id,slug,title,excerpt,body,cover_url,author_name,status,created_by,updated_by,published_at)values(${id}::uuid,${d.slug},${d.title},${d.excerpt},${d.body},${d.coverUrl},${d.authorName},${d.status},${u.id}::uuid,${u.id}::uuid,case when ${d.status}='PUBLISHED'then now()end)on conflict(id)do update set slug=excluded.slug,title=excluded.title,excerpt=excluded.excerpt,body=excluded.body,cover_url=excluded.cover_url,author_name=excluded.author_name,status=excluded.status,is_demo=false,revision=website_articles.revision+1,updated_by=excluded.updated_by,updated_at=now(),published_at=coalesce(website_articles.published_at,excluded.published_at)where website_articles.revision=${d.revision??null} returning id,revision`));if(!r)throw new AppError(409,'CONFLICT','This article changed. Reopen it before saving.');await recordAudit(c.env,{actorUserId:u.id,action:'website.article.saved',targetType:'website_article',targetId:id,requestId:c.get('requestId'),metadata:{slug:d.slug,status:d.status}});return c.json({article:r});});
