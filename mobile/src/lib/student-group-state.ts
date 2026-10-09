type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const optionalText = (value: unknown) => typeof value === 'string' && value ? value : null;
const count = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
const rows = (value: unknown) => Array.isArray(value) ? value.map(record) : [];
export type GroupDetail = {group:{id:string;kind:'COMMUNITY'|'STUDY_GROUP';name:string;description:string;guidelines:string;guidelines_version:number;request_status:string|null;pending_requests:number;avatar_url:string|null;avatar_media_id:string|null;members:number;members_can_post:boolean;joined_at:string|null;member_role:string|null;owner_user_id:string;notifications_enabled:boolean};canPost:boolean};
export type GroupPost = {id:string;title:string;body:string;author_user_id:string;display_name:string;username:string;avatar_url:string|null;author_role:string;urgent:boolean;venue:string|null;media_url:string|null;created_at:string;poll_options:string[];votes:{index:number;count:number}[];my_vote:number|null;comment_count:number;like_count:number;liked_by_me:boolean};
export type GroupComment = {id:string;body:string;media_url:string|null;display_name:string;username:string;author_user_id:string;avatar_url:string|null;created_at:string};
export type GroupMember = {user_id:string;role:string;display_name:string;username:string;avatar_url:string|null};
export function normalizeGroupDetail(value:unknown,id:string):GroupDetail {
 const data=record(value),group=record(data.group);
 return {group:{id:text(group.id,id),kind:group.kind==='STUDY_GROUP'?'STUDY_GROUP':'COMMUNITY',name:text(group.name,'Community'),description:text(group.description),guidelines:text(group.guidelines),guidelines_version:count(group.guidelines_version)||1,request_status:optionalText(group.request_status),pending_requests:count(group.pending_requests),avatar_url:optionalText(group.avatar_url),avatar_media_id:optionalText(group.avatar_media_id),members:count(group.members),members_can_post:group.members_can_post!==false,joined_at:optionalText(group.joined_at),member_role:optionalText(group.member_role),owner_user_id:text(group.owner_user_id),notifications_enabled:group.notifications_enabled===true},canPost:data.canPost===true};
}
export function normalizeGroupPosts(value:unknown):GroupPost[] {
 return rows(record(value).posts).filter(post=>typeof post.id==='string').map(post=>({id:text(post.id),title:text(post.title),body:text(post.body),author_user_id:text(post.author_user_id),display_name:text(post.display_name,'Student'),username:text(post.username),avatar_url:optionalText(post.avatar_url),author_role:text(post.author_role,'MEMBER'),urgent:post.urgent===true,venue:optionalText(post.venue),media_url:optionalText(post.media_url),created_at:text(post.created_at),poll_options:Array.isArray(post.poll_options)?post.poll_options.filter((item):item is string=>typeof item==='string'):[],votes:rows(post.votes).filter(vote=>Number.isInteger(vote.index)).map(vote=>({index:Number(vote.index),count:count(vote.count)})),my_vote:Number.isInteger(post.my_vote)?Number(post.my_vote):null,comment_count:count(post.comment_count),like_count:count(post.like_count),liked_by_me:post.liked_by_me===true}));
}
export function normalizeGroupComments(value:unknown):GroupComment[] {
 return rows(record(value).comments).filter(item=>typeof item.id==='string').map(item=>({id:text(item.id),body:text(item.body),media_url:optionalText(item.media_url),display_name:text(item.display_name,'Student'),username:text(item.username),author_user_id:text(item.author_user_id),avatar_url:optionalText(item.avatar_url),created_at:text(item.created_at)}));
}
export function normalizeGroupMembers(value:unknown):GroupMember[] {
 return rows(record(value).members).filter(item=>typeof item.user_id==='string').map(item=>({user_id:text(item.user_id),role:text(item.role,'MEMBER'),display_name:text(item.display_name,'Student'),username:text(item.username),avatar_url:optionalText(item.avatar_url)}));
}
