import {z} from '@kampusone/contracts';
export const acquisitionSchema=z.object({
 source:z.enum(['FACEBOOK','TIKTOK','WHATSAPP','INSTAGRAM','FRIENDS','OTHER']),
 other:z.string().trim().max(240).default(''),
}).refine(d=>d.source!=='OTHER'||d.other.length>0,'Tell us where you heard about KampusOne.');
