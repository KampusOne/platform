import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getFeedPostText } from "../mobile/src/lib/feed-post-text.ts";

const bodyOnly = (body) => ({ title: "", paragraphs: [body] });

test("the reported short post is rendered once, not as a heading and body", () => {
  assert.deepEqual(getFeedPostText({ title: "How you see am", summary: "How you see am", body: "How you see am" }), bodyOnly("How you see am"));
});

test("older title/summary-only records also render once", () => {
  assert.deepEqual(getFeedPostText({ title: "How you see am", summary: "How you see am" }), bodyOnly("How you see am"));
});

test("generated title and summary excerpts do not repeat a long post", () => {
  const body = "An update for everyone on campus. ".repeat(30);
  assert.deepEqual(getFeedPostText({ title: body.slice(0, 100), summary: body.slice(0, 280), body }), bodyOnly(body.trim()));
});

test("comparison ignores redundant whitespace but preserves body paragraphs", () => {
  assert.deepEqual(getFeedPostText({ title: "Hello campus", summary: " Hello   campus ", body: "Hello\n\ncampus" }), bodyOnly("Hello\n\ncampus"));
});

test("genuine news and event headings, summaries and details remain", () => {
  assert.deepEqual(getFeedPostText({ title: "Engineering career fair", summary: "Meet employers on Friday.", body: "Doors open at 10:00 in the main hall." }), {
    title: "Engineering career fair", paragraphs: ["Meet employers on Friday.", "Doors open at 10:00 in the main hall."],
  });
});

test("a distinct heading is kept when the summary repeats the full body", () => {
  assert.deepEqual(getFeedPostText({ title: "Registration update", summary: "Registration opens on Monday.", body: "Registration opens on Monday." }), {
    title: "Registration update", paragraphs: ["Registration opens on Monday."],
  });
});

test("empty fields do not create empty text rows", () => {
  assert.deepEqual(getFeedPostText({ title: "  ", summary: null }), { title: "", paragraphs: [] });
});

test("legacy title-only and body-only posts still display", () => {
  assert.deepEqual(getFeedPostText({ title: "Campus notice" }), { title: "Campus notice", paragraphs: [] });
  assert.deepEqual(getFeedPostText({ body: "A campus notice." }), bodyOnly("A campus notice."));
});

test("the longest complete field is kept even with unusually ordered API excerpts", () => {
  assert.deepEqual(getFeedPostText({ title: "Classes resume on Monday.", summary: "Classes resume", body: "Classes resume" }), {
    title: "Classes resume on Monday.", paragraphs: [],
  });
});

test("repeated words inside the user's actual body are not edited", () => {
  const body = "We did it!\nWe did it!";
  assert.deepEqual(getFeedPostText({ title: "We did it!", summary: body, body }), bodyOnly(body));
});

test("distinct case-sensitive text and non-prefix overlaps are retained", () => {
  assert.deepEqual(getFeedPostText({ title: "Results", summary: "RESULTS", body: "Check the Results page." }), {
    title: "Results", paragraphs: ["RESULTS", "Check the Results page."],
  });
});

test("the shared card uses deduplicated copy without shrinking action touch targets", () => {
  const source = readFileSync(new URL("../mobile/src/components/feed-post.tsx", import.meta.url), "utf8");
  assert.match(source, /getFeedPostText\(post\)/);
  assert.doesNotMatch(source, />\{post\.(title|summary|body)\}<\/Text>/);
  assert.match(source, /<PostMenu post=\{post\}/);
  assert.match(source, /action: \{[^\n]*minHeight: 44/);
  assert.match(source, /post: \{[^\n]*paddingVertical: 12/);
});
