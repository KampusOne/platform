import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PostLikeStore } from '../mobile/src/lib/post-like-store.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const row = (id, liked = false, like_count = 0) => ({ id, liked, like_count });
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// The comment button deliberately reuses this transport-independent store.
test('comment likes update immediately and prevent rapid duplicate writes', async () => {
  const pending = deferred();
  const writes = [];
  const store = new PostLikeStore({ read: async (ids) => ({ likes: ids.map((id) => row(id)) }), write: (id, liked) => { writes.push([id, liked]); return pending.promise; } });
  try {
    store.load('comment-a'); await store.flush();
    const first = store.toggle('comment-a');
    assert.equal(store.get('comment-a').liked, true);
    assert.equal(store.get('comment-a').count, 1);
    assert.equal(store.get('comment-a').pending, true);
    await store.toggle('comment-a');
    assert.deepEqual(writes, [['comment-a', true]]);
    pending.resolve(row('comment-a', true, 1)); await first;
    assert.equal(store.get('comment-a').pending, false);
  } finally { store.dispose(); }
});

test('a second tap sends an explicit unlike and never makes the count negative', async () => {
  const writes = [];
  const store = new PostLikeStore({ read: async () => ({ likes: [row('comment-a', true, 1)] }), write: async (id, liked) => { writes.push([id, liked]); return row(id, liked, liked ? 1 : 0); } });
  try {
    store.load('comment-a'); await store.flush(); await store.toggle('comment-a');
    assert.deepEqual(writes, [['comment-a', false]]);
    assert.equal(store.get('comment-a').liked, false);
    assert.equal(store.get('comment-a').count, 0);
  } finally { store.dispose(); }
});

test('failed comment likes restore the previous heart and count', async () => {
  const store = new PostLikeStore({ read: async () => ({ likes: [row('comment-a', false, 7)] }), write: async () => { throw new Error('offline'); } });
  try {
    store.load('comment-a'); await store.flush();
    await assert.rejects(store.toggle('comment-a'));
    assert.equal(store.get('comment-a').liked, false);
    assert.equal(store.get('comment-a').count, 7);
    assert.equal(store.get('comment-a').pending, false);
    assert.match(store.get('comment-a').error, /connection/);
  } finally { store.dispose(); }
});

test('late refreshes cannot overwrite a newer comment like', async () => {
  const refresh = deferred(); let reads = 0;
  const store = new PostLikeStore({ read: async () => ++reads === 1 ? { likes: [row('comment-a')] } : refresh.promise, write: async (id, liked) => row(id, liked, 1) });
  try {
    store.load('comment-a'); await store.flush();
    store.load('comment-a'); const reading = store.flush();
    await store.toggle('comment-a');
    refresh.resolve({ likes: [row('comment-a', false, 0)] }); await reading;
    assert.equal(store.get('comment-a').liked, true);
    assert.equal(store.get('comment-a').count, 1);
  } finally { store.dispose(); }
});

test('comment counts are batched in groups no larger than 50', async () => {
  const batches = [];
  const store = new PostLikeStore({ read: async (ids) => { batches.push(ids); return { likes: ids.map((id) => row(id)) }; }, write: async (id, liked) => row(id, liked) });
  try {
    for (let i = 0; i < 61; i++) store.load(`comment-${i}`);
    await store.flush();
    assert.deepEqual(batches.map((ids) => ids.length), [50, 11]);
    assert.equal(store.get('comment-60').ready, true);
  } finally { store.dispose(); }
});

test('an unavailable comment does not show a fabricated zero-like success', async () => {
  const store = new PostLikeStore({ read: async () => ({ likes: [] }), write: async (id, liked) => row(id, liked) });
  try {
    store.load('deleted-comment'); await store.flush();
    assert.equal(store.get('deleted-comment').ready, false);
    assert.equal(store.get('deleted-comment').loading, false);
  } finally { store.dispose(); }
});

test('a disposed account store cannot publish an old user response', async () => {
  const read = deferred(); let publications = 0;
  const store = new PostLikeStore({ read: () => read.promise, write: async (id, liked) => row(id, liked) });
  store.subscribe('comment-a', () => { publications++; });
  store.load('comment-a'); const loading = store.flush();
  store.dispose(); const before = publications;
  read.resolve({ likes: [row('comment-a', true, 9)] }); await loading;
  assert.equal(publications, before);
});

test('comment layout includes identity, photo fallback and its own like control', () => {
  const thread = source('mobile/src/components/comment-thread.tsx');
  assert.match(thread, /comments\.map/);
  assert.match(thread, /<ProfileAvatar name=\{comment\.author_name\} imageUrl=\{comment\.author_image_url\}/);
  assert.doesNotMatch(thread, /comment\.author_username/);
  assert.match(thread, /<RelativeTime value=\{comment.created_at\}/);
  assert.match(thread, /<CommentLikeButton commentId=\{comment\.id\}/);
  assert.match(thread, /comment\.can_delete \?/);
  const avatar = source('mobile/src/components/profile-avatar.tsx');
  assert.match(avatar, /onError/);
  assert.match(avatar, /failedUrl !== uri/);
  assert.match(avatar, /initials/);
});

test('existing and newly-created comments both return the saved profile identity', () => {
  const backend = source('server/src/routes/feed-social.ts');
  assert.equal((backend.match(/author\.profile_image_url as author_image_url/g) ?? []).length, 2);
  assert.equal((backend.match(/author\.username as author_username/g) ?? []).length, 2);
});

test('comment likes are isolated from post likes and registered before generic routes', () => {
  const button = source('mobile/src/components/comment-like-button.tsx');
  assert.match(button, /comment-likes\?ids=/);
  assert.match(button, /feed\/comments\/\$\{encodeURIComponent\(id\)\}\/like/);
  assert.match(button, /current\?\.store\.dispose\(\)/);
  const routes = source('server/src/routes/feed-posts.ts');
  assert.ok(routes.indexOf('route("/", feedCommentLikeRoutes)') < routes.indexOf('route("/", feedSocialRoutes)'));
});
