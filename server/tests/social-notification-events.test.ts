import {beforeAll,afterAll,beforeEach,describe,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase} from './helpers/database';
let db:PGlite;const author=crypto.randomUUID(),commenter=crypto.randomUUID(),actor=crypto.randomUUID(),campus=crypto.randomUUID(),post=crypto.randomUUID(),parent=crypto.randomUUID(),source=crypto.randomUUID();
beforeAll(async()=>{db=await createTestDatabase();await db.query("insert into universities(id,name,slug,updated_at) values($1,'Notification test','notice-test',now())",[campus]);for(const uid of [author,commenter,actor]){await db.query("insert into users(id,email,password_hash,updated_at) values($1,$2,'test',now())",[uid,uid+'@test.invalid']);await db.query("insert into profiles(id,user_id,username,display_name,university_id,updated_at) values(gen_random_uuid(),$1,$2,'Test student',$3,now())",[uid,'n_'+uid.slice(0,8),campus]);}await db.query("insert into content_sources(id,university_id,name) values($1,$2,'Source')",[source,campus]);await db.query("insert into feed_posts(id,university_id,author_user_id,source_id,category,summary,title,body,status,published_at) values($1,$2,$3,$4,'UPDATE','Summary','Post','Long existing post','PUBLISHED',now())",[post,campus,author,source]);await db.query("insert into feed_comments(id,post_id,institution_id,author_user_id,body,client_request_id) values($1,$2,$3,$4,'Comment',gen_random_uuid())",[parent,post,campus,commenter]);},60000);
afterAll(async()=>db?.close());
beforeEach(async()=>{await db.exec("truncate in_app_notifications,app_private.notification_outbox cascade;delete from user_blocks;delete from feed_comment_likes;delete from feed_likes;update profiles set settings='{}'");});
describe('durable social notifications',()=>{
 it('notifies the comment owner once for a like, without default phone push',async()=>{
  for(let i=0;i<2;i++)await db.query('insert into feed_comment_likes(comment_id,user_id,institution_id) values($1,$2,$3) on conflict do nothing',[parent,actor,campus]);
  const rows=(await db.query('select user_id,category,path from in_app_notifications')).rows;expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({user_id:commenter,category:'commentLikes'});expect(String(rows[0].path)).toContain(parent);expect((await db.query('select id from app_private.notification_outbox')).rows).toHaveLength(0);
 });
 it('sends a reply to the parent comment owner and allows distinct replies',async()=>{
  for(let i=0;i<2;i++)await db.query("insert into feed_comments(post_id,institution_id,author_user_id,body,client_request_id,parent_comment_id) values($1,$2,$3,'Reply',gen_random_uuid(),$4)",[post,campus,actor,parent]);
  const rows=(await db.query('select user_id,category from in_app_notifications')).rows;expect(rows).toHaveLength(2);expect(rows.every((r:any)=>r.user_id===commenter&&r.category==='replies')).toBe(true);
 });
 it('suppresses self-interaction, disabled categories and blocked relationships',async()=>{
  await db.query('insert into feed_comment_likes(comment_id,user_id,institution_id) values($1,$2,$3)',[parent,commenter,campus]);
  await db.query("update profiles set settings=$2::jsonb where user_id=$1",[commenter,JSON.stringify({notificationChannels:{commentLikes:{in_app_enabled:false,push_enabled:false}}})]);
  await db.query('insert into feed_comment_likes(comment_id,user_id,institution_id) values($1,$2,$3)',[parent,actor,campus]);
  await db.query('insert into user_blocks(blocker_id,blocked_id) values($1,$2)',[author,actor]);
  await db.query('insert into feed_likes(post_id,user_id,institution_id) values($1,$2,$3)',[post,actor,campus]);
  expect((await db.query('select id from in_app_notifications')).rows).toHaveLength(0);
 });
 it('delivers an explicitly opted-in push independently of the in-app channel',async()=>{
  await db.query('update profiles set settings=$2::jsonb where user_id=$1',[commenter,JSON.stringify({notificationChannels:{commentLikes:{in_app_enabled:false,push_enabled:true}}})]);
  await db.query('insert into feed_comment_likes(comment_id,user_id,institution_id) values($1,$2,$3)',[parent,actor,campus]);
  expect((await db.query('select in_app_visible from in_app_notifications')).rows).toEqual([{in_app_visible:false}]);expect((await db.query("select channel from app_private.notification_outbox")).rows).toEqual([{channel:'PUSH'}]);
 });
});
