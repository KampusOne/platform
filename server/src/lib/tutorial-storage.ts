import {sql} from 'drizzle-orm';
import {database,firstRow} from './database';
import {AppError} from './errors';
import {sha256} from './security';
import type {Bindings} from '../types';
export type TutorialAsset={id:string;owner_user_id:string;institution_id:string;provider:string;provider_video_id:string|null;provider_library_id:string|null;original_name:string;content_type:string;expected_bytes:number;state:string;media_id:string|null};
export function bunnyConfigured(env:Bindings){return Boolean(env.BUNNY_STREAM_API_KEY&&/^\d+$/.test(env.BUNNY_STREAM_LIBRARY_ID??'')&&env.BUNNY_STREAM_TOKEN_KEY);}
export async function reserveTutorialVideo(env:Bindings,input:{id:string;user:string;institution:string|null;name:string;mime:string;size:number}){
 try{return firstRow(await database(env).execute<TutorialAsset>(sql`select * from app_private.reserve_tutorial_video(${input.id}::uuid,${input.user}::uuid,${input.institution}::uuid,${input.name},${input.mime},${input.size},${bunnyConfigured(env)})`))!;}
 catch(error){const message=String(error);
  if(message.includes('VIDEO_TUTOR_FORBIDDEN'))throw new AppError(403,'FORBIDDEN','Only an approved tutor can upload tutorial videos for this campus.');
  if(message.includes('VIDEO_BUNNY_REQUIRED'))throw new AppError(503,'PROVIDER_UNAVAILABLE','Tutorial video storage has reached its current allowance. The admin can connect Bunny Stream or extend the allowance. Your file remains on your device.');
  if(message.includes('VIDEO_DAILY_ALLOWANCE'))throw new AppError(429,'RATE_LIMITED','Your video upload allowance is reached. Resume existing uploads or try again later.');
  if(/VIDEO_UPLOAD_CONFLICT|VIDEO_UPLOAD_EXPIRED/.test(message))throw new AppError(409,'CONFLICT','Choose this video again to start a new upload.');
  throw error;
 }
}
export async function bunnyRequest(env:Bindings,library:string,path:string,init:RequestInit={}){
 if(!env.BUNNY_STREAM_API_KEY||library!==env.BUNNY_STREAM_LIBRARY_ID)throw new AppError(503,'PROVIDER_UNAVAILABLE','The video library is not configured.');
 const result=await fetch(`https://video.bunnycdn.com/library/${library}/videos${path}`,{...init,headers:{AccessKey:env.BUNNY_STREAM_API_KEY,Accept:'application/json','Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(20000)});
 if(!result.ok)throw new AppError(503,'PROVIDER_UNAVAILABLE','The video provider could not complete this step. Your upload is kept; try again.');
 return result.json() as Promise<Record<string,unknown>>;
}
export async function bunnyUploadAuthorization(env:Bindings,asset:TutorialAsset){
 const library=asset.provider_library_id!,video=asset.provider_video_id!,expires=Math.floor(Date.now()/1000)+20*3600;
 if(!bunnyConfigured(env)||library!==env.BUNNY_STREAM_LIBRARY_ID)throw new AppError(503,'PROVIDER_UNAVAILABLE','Bunny Stream is not configured for this video library.');
 const signature=await sha256(library+env.BUNNY_STREAM_API_KEY+expires+video);
 return {endpoint:'https://video.bunnycdn.com/tusupload',headers:{AuthorizationSignature:signature,AuthorizationExpire:String(expires),LibraryId:library,VideoId:video}};
}
export async function bunnyPlayback(env:Bindings,asset:TutorialAsset){
 if(!env.BUNNY_STREAM_TOKEN_KEY||asset.provider_library_id!==env.BUNNY_STREAM_LIBRARY_ID)throw new AppError(503,'PROVIDER_UNAVAILABLE','Protected playback is not configured for this video library.');
 const expires=Math.floor(Date.now()/1000)+2*3600,token=await sha256(env.BUNNY_STREAM_TOKEN_KEY+asset.provider_video_id+expires);
 return {kind:'embed' as const,url:`https://player.mediadelivery.net/embed/${asset.provider_library_id}/${asset.provider_video_id}?token=${token}&expires=${expires}&autoplay=false&preload=true&responsive=true`,expiresIn:7200};
}
