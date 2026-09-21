import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mergeById, safeCount } from "../mobile/src/lib/feed-social.ts";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
test("a refreshed or paginated post is not duplicated", () => {
  assert.deepEqual(mergeById([{ id: "a", count: 1 }], [{ id: "a", count: 2 }, { id: "b", count: 0 }]), [{ id: "a", count: 2 }, { id: "b", count: 0 }]);
});
test("engagement counts never render NaN or negative values", () => {
  for (const value of [undefined, null, "bad", Infinity, -3]) assert.equal(safeCount(value), 0);
  assert.equal(safeCount("4"), 4); assert.equal(safeCount(4.8), 4);
});
test("comments preserve retry IDs until the draft changes", () => {
  const source = read("mobile/src/components/comment-thread.tsx");
  assert.match(source, /requestId: requestId.current/); assert.match(source, /mutationLock.current/);
  assert.match(source, /comment.can_delete/); assert.match(source, /\/comments\/\$\{selected.id\}/);
});
test("the shared card has comments, reposts, and nested quote previews without duplicating text", () => {
  const source = read("mobile/src/components/feed-post.tsx");
  assert.match(source, /getFeedPostText\(post\)/); assert.match(source, /<RepostAction/);
  assert.match(source, /<QuotedPostPreview/); assert.match(source, /openComments/);
  assert.match(source, /action: \{[^\n]*minHeight: 44/); assert.match(source, /post: \{[^\n]*paddingVertical: 12/);
});
test("quote composition submits a reference, not copied original text", () => {
  const source = read("mobile/app/compose.tsx");
  assert.match(source, /quotedPostId: quoteId/); assert.match(source, /lock.current/);
  assert.doesNotMatch(source, /body:\s*original\.body/);
});
test("quote previews become unavailable when the original is deleted", () => {
  const source = read("mobile/src/components/quoted-post.tsx");
  assert.match(source, /wasPostDeleted/); assert.match(source, /Original post unavailable/);
});
