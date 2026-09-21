import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { commentsPath, deleteFromThread, mergeComments } from '../mobile/src/lib/comment-replies.ts';
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const comment = (id, parent = null, at = '2026-09-21T12:00:00Z') => ({ id, parent_comment_id: parent, created_at: at, body: 'Text', author_name: 'Author', author_image_url: 'photo', author_username: 'author', author_verified: true, can_delete: true });

test('root requests stay compatible and reply pages encode parent and cursor', () => {
  assert.equal(commentsPath('post'), '/v1/student/feed/post/comments');
  const url = new URL(commentsPath('post', 'parent', '2026-09-21T12:00:00Z|id'), 'https://test.local');
  assert.equal(url.searchParams.get('parentCommentId'), 'parent');
  assert.equal(url.searchParams.get('cursor'), '2026-09-21T12:00:00Z|id');
});
test('reply pages cannot leak into roots or another comment branch', () => {
  assert.deepEqual(mergeComments([], [comment('root'), comment('a','one'), comment('b','two')], 'one').map(c => c.id), ['a']);
  assert.deepEqual(mergeComments([], [comment('root'), comment('a','one')], null).map(c => c.id), ['root']);
});
test('retries and overlapping pages deduplicate by ID with deterministic order', () => {
  const incoming = { ...comment('b','parent'), body: 'Updated' };
  const result = mergeComments([comment('b','parent')], [incoming, comment('a','parent')], 'parent');
  assert.deepEqual(result.map(c => c.id), ['a','b']);
  assert.equal(result[1].body, 'Updated');
});
test('leaf deletion removes only that comment', () => {
  assert.deepEqual(deleteFromThread([comment('a'),comment('b')], 'a', { retained:false, reply_count:0 }).map(c => c.id), ['b']);
});
test('parent deletion keeps its ID but clears text, photo, username, badge and controls', () => {
  const result = deleteFromThread([comment('root')], 'root', { retained:true, reply_count:2 });
  assert.equal(result[0].id, 'root');
  assert.equal(result[0].body, '');
  assert.equal(result[0].author_name, 'Comment deleted');
  assert.equal(result[0].author_image_url, null);
  assert.equal(result[0].author_username, null);
  assert.equal(result[0].author_verified, false);
  assert.equal(result[0].can_delete, false);
  assert.equal(result[0].is_deleted, true);
  assert.equal(result[0].reply_count, 2);
});
test('composer targets its own branch and keeps failed drafts and collapsed trees', () => {
  const ui = source('mobile/src/components/comment-thread.tsx');
  assert.match(ui, /parentCommentId: parentId/);
  assert.match(ui, /Replying to/);
  assert.match(ui, /accessibilityLabel="Cancel reply"/);
  assert.match(ui, /<CommentList postId=\{postId\} parentComment=\{comment\}/);
  assert.match(ui, /opened\.has\(comment\.id\)/);
  assert.match(ui, /depth === 1 && styles\.replies/);
  assert.match(ui, /mutationLock\.current = true/);
  assert.match(ui, /version === generation\.current/);
});
test('server binds retry keys and parent lookups to the same post', () => {
  const api = source('server/src/routes/feed-social.ts');
  assert.match(api, /feed_comments\.parent_comment_id is not distinct from excluded\.parent_comment_id/);
  assert.match(api, /target\.id = parents\.post_id and target\.university_id = parents\.institution_id/);
  assert.match(api, /for update of parents/);
  assert.match(api, /comments\.parent_comment_id is not distinct from/);
  assert.match(api, /case when comments\.deleted_at is null then comments\.body else '' end/);
});
