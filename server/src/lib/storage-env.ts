import * as yup from 'yup';
import type {Bindings} from '../types';
import {AppError} from './errors';
const ttl=(fallback:number)=>yup.number().integer().min(60).max(7200).default(fallback);
const schema=yup.object({
 R2_ACCOUNT_ID:yup.string().required().matches(/^[a-f0-9]{32}$/i),
 R2_ACCESS_KEY_ID:yup.string().required().min(16),
 R2_SECRET_ACCESS_KEY:yup.string().required().min(32),
 R2_PRIVATE_BUCKET_NAME:yup.string().required().matches(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
 R2_MEDIA_BUCKET_NAME:yup.string().default('kampusone-media').matches(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
 R2_UPLOAD_URL_TTL_SECONDS:ttl(600),
 R2_PLAYBACK_URL_TTL_SECONDS:ttl(7200),
});
export function storageEnabled(env:Bindings){return env.R2_DIRECT_UPLOADS_ENABLED==='true';}
export function storageConfig(env:Bindings){
 try{return schema.validateSync(env,{abortEarly:false,stripUnknown:true});}
 catch(error){
  // Yup's normal messages include rejected values. Return only variable names;
  // provider credentials must never enter responses or logs.
  const names=error instanceof yup.ValidationError?[...new Set(error.inner.map(e=>e.path).filter(Boolean))].join(', '):'storage configuration';
  throw new AppError(503,'PROVIDER_UNAVAILABLE','Storage configuration is incomplete: '+names+'.');
 }
}
export function validateStorageEnv(env:Bindings){
 if(env.R2_DIRECT_UPLOADS_ENABLED!==undefined&&!['true','false'].includes(env.R2_DIRECT_UPLOADS_ENABLED))throw new AppError(503,'PROVIDER_UNAVAILABLE','R2_DIRECT_UPLOADS_ENABLED must be true or false.');
 if(storageEnabled(env)){storageConfig(env);if(!env.PRIVATE_BUCKET)throw new AppError(503,'PROVIDER_UNAVAILABLE','PRIVATE_BUCKET binding is missing.');}
}
