import {Hono} from 'hono';
import {sql} from 'drizzle-orm';
import {z} from '@kampusone/contracts';
import {database,firstRow} from '../lib/database';
import {currentUser,requireAuth} from '../middleware/auth';
import {input,id} from '../lib/input';
import {AppError} from '../lib/errors';
import {bunnyConfigured,bunnyRequest,bunnyUploadAuthorization,bunnyPlayback,reserveTutorialVideo,type TutorialAsset} from '../lib/tutorial-storage';
import {canReadMedia} from './media';
import {resolveAdminScope} from '../lib/admin-access';
import {recordAudit} from '../lib/audit';
import type {Bindings,Variables} from '../types';
export const tutorialStorageRoutes=new Hono<{Bindings:Bindings;Variables:Variables}>();
tutorialStorageRoutes.use('*',requireAuth);
tutorialStorageRoutes.use('*',async(c,next)=>{c.header('Cache-Control','private, no-store');await next();});
tutorialStorageRoutes.get('/settings',async c=>{
 await resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'),'content.view');
 const controls=firstRow(await database(c.env).execute(sql`select bunny_after,(select count(*)::int from app_private.tutorial_video_assets where provider<>'BUNNY' and state<>'FAILED' and (media_id is not null or expires_at>now()))+(select count(distinct media_object_id)::int from public.tutorial_resources where resource_type='VIDEO' and deleted_at is null and media_object_id is not null and not exists(select 1 from app_private.tutorial_video_assets where media_id=tutorial_resources.media_object_id)) as initial_videos from app_private.tutorial_storage_controls where singleton`));
 return c.json({controls,bunnyReady:bunnyConfigured(c.env),vdoCipherReady:Boolean(c.env.VDOCIPHER_API_SECRET),cloudinaryReady:Boolean(c.env.CLOUDINARY_CLOUD_NAME&&c.env.CLOUDINARY_API_KEY&&c.env.CLOUDINARY_API_SECRET),r2Ready:Boolean(c.env.PRIVATE_BUCKET),requiredBunnyVariables:['BUNNY_STREAM_API_KEY','BUNNY_STREAM_LIBRARY_ID','BUNNY_STREAM_TOKEN_KEY']});
});
tutorialStorageRoutes.put('/settings',async c=>{
 const user=currentUser(c),scope=await resolveAdminScope(c.env,user,undefined,'content.manage');
 if(scope!==null)throw new AppError(403,'FORBIDDEN','Video storage settings require access to every university.');
 const d=await input(c,z.object({bunnyAfter:z.number().int().min(1).max(10000)}).strict());
 await database(c.env).execute(sql`update app_private.tutorial_storage_controls set bunny_after=${d.bunnyAfter},updated_by=${user.id}::uuid,updated_at=now() where singleton`);
 await recordAudit(c.env,{actorUserId:user.id,action:'tutorial.storage.threshold.updated',targetType:'tutorial_storage',targetId:'global',requestId:c.get('requestId'),metadata:{bunnyAfter:d.bunnyAfter}});
 return c.json({saved:true});
});
tutorialStorageRoutes.post('/uploads',async c=>{
 const user=currentUser(c),d=await input(c,z.object({uploadId:z.string().uuid(),name:z.string().trim().min(1).max(180),type:z.enum(['video/mp4','video/webm']),size:z.number().int().min(1).max(500*1024*1024)}).strict());
 const db=database(c.env);let asset=await reserveTutorialVideo(c.env,{id:d.uploadId,user:user.id,institution:user.universityId,name:d.name,mime:d.type,size:d.size});
 if(asset.media_id)return c.json({id:asset.id,provider:asset.provider,status:'COMPLETE',mediaId:asset.media_id});
 if(asset.provider==='R2')return c.json({id:asset.id,provider:'R2',status:'OPEN'});
 if(!asset.provider_video_id){
  const claimed=firstRow(await db.execute<TutorialAsset>(sql`update app_private.tutorial_video_assets set state='CREATING',updated_at=now() where id=${asset.id}::uuid and provider_video_id is null and (state='RESERVED' or state='CREATING' and updated_at<now()-interval '1 minute') returning *`));
  if(!claimed)throw new AppError(409,'CONFLICT','Your video upload is being prepared. Try again in a moment.');
  try{
   const video=await bunnyRequest(c.env,c.env.BUNNY_STREAM_LIBRARY_ID!,'',{method:'POST',body:JSON.stringify({title:d.name})});
   if(typeof video.guid!=='string'||!z.string().uuid().safeParse(video.guid).success)throw new Error('Video identifier unavailable');
   asset=firstRow(await db.execute<TutorialAsset>(sql`update app_private.tutorial_video_assets set provider_video_id=${video.guid},provider_library_id=${c.env.BUNNY_STREAM_LIBRARY_ID!},state='RESERVED',updated_at=now() where id=${asset.id}::uuid returning *`))!;
  }catch(error){await db.execute(sql`update app_private.tutorial_video_assets set state='RESERVED',updated_at=now() where id=${asset.id}::uuid and provider_video_id is null`);throw error;}
 }
 return c.json({id:asset.id,provider:'BUNNY',status:'OPEN',authorization:await bunnyUploadAuthorization(c.env,asset)});
});
tutorialStorageRoutes.post('/uploads/:id/complete',async c=>{
 const user=currentUser(c),asset=firstRow(await database(c.env).execute<TutorialAsset>(sql`select * from app_private.tutorial_video_assets where id=${id(c.req.param('id'))}::uuid and owner_user_id=${user.id}::uuid and institution_id=${user.universityId}::uuid`));
 if(!asset)throw new AppError(404,'NOT_FOUND','Video upload not found.');if(asset.media_id)return c.json({id:asset.media_id});
 if(asset.provider!=='BUNNY'||!asset.provider_video_id)throw new AppError(409,'CONFLICT','Finish uploading this video first.');
 const video=await bunnyRequest(c.env,asset.provider_library_id!,'/'+asset.provider_video_id);
 if(!Number(video.storageSize)||Number(video.status)===0)throw new AppError(409,'CONFLICT','The video has not reached the provider yet. Resume the upload.');
 const unprotected=await fetch(`https://player.mediadelivery.net/embed/${asset.provider_library_id}/${asset.provider_video_id}`,{redirect:'manual',signal:AbortSignal.timeout(10000)});
 if(unprotected.status!==403)throw new AppError(503,'PROVIDER_UNAVAILABLE','Enable embed token authentication in your Bunny Stream library before publishing protected videos. Your upload is kept.');
 await database(c.env).execute(sql`with media as(insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name)
  values(${asset.id}::uuid,${user.id}::uuid,${asset.institution_id}::uuid,'resource',${'bunny:'+asset.provider_library_id+':'+asset.provider_video_id},${asset.content_type},${Number(asset.expected_bytes)},${asset.original_name}) on conflict(id) do nothing)
  update app_private.tutorial_video_assets set state='UPLOADED',media_id=${asset.id}::uuid,updated_at=now() where id=${asset.id}::uuid`);
 return c.json({id:asset.id});
});
tutorialStorageRoutes.post('/playback/:id',async c=>{
 const media=firstRow(await database(c.env).execute<{id:string;owner_user_id:string;institution_id:string;kind:string;object_key:string;content_type:string}>(sql`select id,owner_user_id,institution_id,kind,object_key,content_type from public.media_objects where id=${id(c.req.param('id'))}::uuid and kind='resource' and content_type in('video/mp4','video/webm') and deleted_at is null`));
 if(!media)throw new AppError(404,'NOT_FOUND','This tutorial video is unavailable.');await canReadMedia(c.env,currentUser(c),media);
 const asset=firstRow(await database(c.env).execute<TutorialAsset>(sql`select * from app_private.tutorial_video_assets where media_id=${media.id}::uuid`));
 if(asset?.provider==='BUNNY'){
  const video=await bunnyRequest(c.env,asset.provider_library_id!,'/'+asset.provider_video_id);
  if(Number(video.encodeProgress)!==100)throw new AppError(409,'CONFLICT','This video is still being processed. Try again shortly.');
  return c.json(await bunnyPlayback(c.env,asset));
 }
 return c.json({kind:'file',mediaId:media.id});
});
