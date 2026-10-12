import {draftFormatError,draftIdentifier,draftRecord,draftString} from './draft-fields';
import type {PreparedPhoto} from './uploads';
export type BusinessFields={displayName:string;biography:string;categories:string;phone:string;whatsapp:string;pickupLocation:string;avatarMediaId:string|null;coverMediaId:string|null};
export type BusinessProfile={agentType:'VENDOR'|'TUTOR'|'RIDER';displayName:string;biography:string;categories:string[];phone:string|null;whatsapp:string|null;pickupLocation:string|null;profileImageUrl:string|null;coverImageUrl:string|null;avatarMediaId:string|null;coverMediaId:string|null;revision?:string};
export type BusinessDraft={fields:BusinessFields;base:BusinessFields;revision?:string;photos?:Partial<Record<'avatar'|'cover',PreparedPhoto>>;missingPhotos?:('avatar'|'cover')[]};
export function businessFields(profile:BusinessProfile):BusinessFields {
  return{displayName:profile.displayName,biography:profile.biography,categories:profile.categories.join(', '),phone:profile.phone??'',whatsapp:profile.whatsapp??'',pickupLocation:profile.pickupLocation??'',avatarMediaId:profile.avatarMediaId,coverMediaId:profile.coverMediaId};
}
function parseFields(value:unknown):BusinessFields{
  const row=draftRecord(value);
  return{displayName:draftString(row,'displayName','',120),biography:draftString(row,'biography','',2000),categories:draftString(row,'categories','',408),phone:draftString(row,'phone','',20),whatsapp:draftString(row,'whatsapp','',20),pickupLocation:draftString(row,'pickupLocation','',500),avatarMediaId:draftIdentifier(row,'avatarMediaId')??null,coverMediaId:draftIdentifier(row,'coverMediaId')??null};
}
export function restoreBusinessDraft(value:unknown):BusinessDraft {
  const row=draftRecord(value),revision=draftString(row,'revision','',64),photos:BusinessDraft['photos']={};
  if(row.photos!==undefined){const raw=draftRecord(row.photos);for(const kind of ['avatar','cover'] as const){if(raw[kind]===undefined)continue;const photo=draftRecord(raw[kind]),uri=draftString(photo,'uri','',4096),name=draftString(photo,'name','',255);if(!/^(file|content):\/\//.test(uri)||!name||photo.type!=='image/jpeg'||typeof photo.width!=='number'||typeof photo.height!=='number'||!Number.isFinite(photo.width)||!Number.isFinite(photo.height)||photo.width<=0||photo.height<=0||photo.width>20000||photo.height>20000)throw draftFormatError();photos[kind]={uri,name,type:'image/jpeg',width:photo.width,height:photo.height};}}
  const missingPhotos=row.missingPhotos??[];
  if(!Array.isArray(missingPhotos)||missingPhotos.length>2||missingPhotos.some(kind=>kind!=='avatar'&&kind!=='cover')||new Set(missingPhotos).size!==missingPhotos.length)throw draftFormatError();
  return{fields:parseFields(row.fields),base:parseFields(row.base),...(revision?{revision}:{}),photos,missingPhotos};
}
/** Browser image bytes stay in RAM. Persist only bounded native file references. */
export function businessDraft(fields:BusinessFields,base:BusinessFields,revision:string|undefined,photos:BusinessDraft['photos'],missingPhotos:('avatar'|'cover')[]):BusinessDraft {
  const retained:BusinessDraft['photos']={},missing=new Set(missingPhotos);
  for(const kind of ['avatar','cover'] as const){const photo=photos?.[kind];if(!photo)continue;if(/^(file|content):\/\//.test(photo.uri)&&photo.uri.length<=4096)retained[kind]={uri:photo.uri,name:photo.name,type:photo.type,width:photo.width,height:photo.height};else missing.add(kind);}
  return{fields,base,...(revision?{revision}:{}),photos:retained,missingPhotos:[...missing]};
}
export function businessPayload(fields:BusinessFields){
  const phone=(value:string)=>{const digits=value.replace(/[\s()-]/g,'');if(!digits)return null;if(/^0[789]\d{9}$/.test(digits))return'+234'+digits.slice(1);if(/^234[789]\d{9}$/.test(digits))return'+'+digits;if(/^\+234[789]\d{9}$/.test(digits))return digits;throw new Error('Use a Nigerian mobile number, such as 08012345678 or +2348012345678.');};
  const categories=[...new Set(fields.categories.split(',').map(value=>value.trim()).filter(Boolean))];
  if(fields.displayName.trim().length<2)throw new Error('Enter a business name with at least two characters.');
  if(categories.length>8||categories.some(value=>value.length<2||value.length>50))throw new Error('Choose up to eight categories, with 2–50 characters each.');
  return{displayName:fields.displayName.trim(),biography:fields.biography.trim(),categories,phone:phone(fields.phone),whatsapp:phone(fields.whatsapp),pickupLocation:fields.pickupLocation.trim()||null,avatarMediaId:fields.avatarMediaId,coverMediaId:fields.coverMediaId};
}
export function sameBusinessFields(a:BusinessFields,b:BusinessFields){try{return JSON.stringify(businessPayload(a))===JSON.stringify(businessPayload(b));}catch{return false;}}
