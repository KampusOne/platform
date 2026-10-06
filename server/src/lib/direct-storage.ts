import {AwsClient} from 'aws4fetch';
import type {Bindings} from '../types';
import {AppError} from './errors';
import {storageConfig} from './storage-env';
export type StoragePart={partNumber:number;etag:string;size:number};
function objectUrl(account:string,bucket:string,key:string){
 if(!key||key.startsWith('/')||key.split('/').some(p=>p==='..'||p==='.')||/[\x00-\x1f]/.test(key))throw new AppError(400,'BAD_REQUEST','Invalid storage object.');
 return new URL('https://'+account+'.r2.cloudflarestorage.com/'+bucket+'/'+key.split('/').map(encodeURIComponent).join('/'));
}
function client(env:Bindings){const config=storageConfig(env);return {config,aws:new AwsClient({accessKeyId:config.R2_ACCESS_KEY_ID,secretAccessKey:config.R2_SECRET_ACCESS_KEY,service:'s3',region:'auto',retries:0})};}
export async function signedUploadPart(env:Bindings,key:string,uploadId:string,part:number,size:number){
 const {config,aws}=client(env),url=objectUrl(config.R2_ACCOUNT_ID,config.R2_PRIVATE_BUCKET_NAME,key);
 url.searchParams.set('uploadId',uploadId);url.searchParams.set('partNumber',String(part));url.searchParams.set('X-Amz-Expires',String(config.R2_UPLOAD_URL_TTL_SECONDS));
 const headers={'Content-Type':'application/octet-stream'};
 const signed=await aws.sign(url,{method:'PUT',headers:{...headers,'Content-Length':String(size)},aws:{signQuery:true,allHeaders:true}});
 return {url:signed.url,headers,expiresIn:config.R2_UPLOAD_URL_TTL_SECONDS};
}
export function parseStorageParts(xml:string):StoragePart[]{
 if(xml.length>128*1024||!/<ListPartsResult(?:\s[^>]*)?>/.test(xml)||/<IsTruncated>true<\/IsTruncated>/.test(xml))throw new AppError(502,'PROVIDER_UNAVAILABLE','Storage could not confirm the upload. Try again.');
 const parts:StoragePart[]=[];
 for(const match of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)){
  const body=match[1]!,partNumber=Number(/<PartNumber>(\d+)<\/PartNumber>/.exec(body)?.[1]),size=Number(/<Size>(\d+)<\/Size>/.exec(body)?.[1]);
  const etag=/<ETag>([^<]+)<\/ETag>/.exec(body)?.[1]?.replace(/&quot;/g,'"').replace(/^"|"$/g,'');
  if(!Number.isInteger(partNumber)||partNumber<1||!Number.isSafeInteger(size)||size<1||!etag||!/^[a-f0-9]{32}$/i.test(etag)||parts.some(p=>p.partNumber===partNumber))throw new AppError(502,'PROVIDER_UNAVAILABLE','Storage returned an invalid upload receipt.');
  parts.push({partNumber,size,etag});
 }
 return parts.sort((a,b)=>a.partNumber-b.partNumber);
}
export async function listUploadParts(env:Bindings,key:string,uploadId:string){
 const {config,aws}=client(env),url=objectUrl(config.R2_ACCOUNT_ID,config.R2_PRIVATE_BUCKET_NAME,key);
 url.searchParams.set('uploadId',uploadId);url.searchParams.set('max-parts','1000');
 const signed=await aws.sign(url,{method:'GET'}),response=await fetch(signed,{signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new AppError(502,'PROVIDER_UNAVAILABLE','Storage could not confirm uploaded chunks. Retry to resume.');
 return parseStorageParts(await response.text());
}
export async function signedPlayback(env:Bindings,media:{object_key:string;content_type:string;private:boolean}){
 const {config,aws}=client(env),url=objectUrl(config.R2_ACCOUNT_ID,media.private?config.R2_PRIVATE_BUCKET_NAME:config.R2_MEDIA_BUCKET_NAME,media.object_key);
 // Private bearer URLs must stay short-lived because account, block, purchase,
 // review and staff permissions can be revoked after a URL is issued.
 const expiresIn=media.private?Math.min(config.R2_PLAYBACK_URL_TTL_SECONDS,90):config.R2_PLAYBACK_URL_TTL_SECONDS;
 url.searchParams.set('X-Amz-Expires',String(expiresIn));
 url.searchParams.set('response-content-type',media.content_type);url.searchParams.set('response-content-disposition','inline');
 const signed=await aws.sign(url,{method:'GET',aws:{signQuery:true}});
 return {url:signed.url,expiresIn};
}
