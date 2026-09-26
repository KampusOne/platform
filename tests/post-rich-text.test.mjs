import assert from "node:assert/strict";
import test from "node:test";
import { postTokens, postExcerpt, activeHashtag } from "../mobile/src/lib/post-rich-text.ts";

test("existing posts expose links and tags without migrating stored copy", () => {
  const text = "Results: https://results.neco.gov.ng. #KampusOne #JAMB";
  const tokens = postTokens(text);
  assert.equal(tokens.map((token) => token.text).join(""), text);
  assert.equal(tokens.find((token) => token.kind === "link").target, "https://results.neco.gov.ng/");
  assert.deepEqual(tokens.filter((token) => token.kind === "hashtag").map((token) => token.target), ["#KampusOne", "#JAMB"]);
});
test("never makes script, data or credential URLs clickable", () => {
  for (const text of ["javascript:alert(1)", "data:text/html,hello", "https://user:password@example.com"]) assert.equal(postTokens(text).filter((token) => token.kind === "link").length, 0);
});
test("URL fragments stay with the URL and punctuation stays in the post", () => {
  const tokens = postTokens("See (https://example.com/wiki/Test_(example)). https://example.com/#section www.kampusone.app!");
  assert.equal(tokens.filter((token) => token.kind === "hashtag").length, 0);
  assert.deepEqual(tokens.filter((token) => token.kind === "link").map((token) => token.target), ["https://example.com/wiki/Test_(example)", "https://example.com/#section", "https://www.kampusone.app/"]);
});
test("Unicode tags work, embedded word fragments are not hashtags", () => {
  assert.deepEqual(postTokens("#Ẹ̀kọ́ #2026 #UNIBEN word#fragment").filter((token) => token.kind === "hashtag").map((token) => token.text), ["#Ẹ̀kọ́", "#2026", "#UNIBEN"]);
});
test("long copy and many short lines collapse; short copy remains exact", () => {
  const long = "Campus news for students. ".repeat(200);
  assert.equal(postExcerpt(long).collapsed, true);
  assert.ok(postExcerpt(long).text.length <= 361);
  assert.equal(postExcerpt("a\nb\nc\nd\ne\nf\ng\nh").collapsed, true);
  assert.deepEqual(postExcerpt("Hello campus"), { text: "Hello campus", collapsed: false });
});
test("composer detects active tag at insertion point and permits new tags", () => {
  assert.deepEqual(activeHashtag("Hi #UNI"), { query: "UNI", start: 3, end: 7 });
  assert.equal(activeHashtag("https://example.com/#UNI"), null);
  assert.equal(activeHashtag("#UNIBEN "), null);
  assert.deepEqual(activeHashtag("#NEW rest", 4), { query: "NEW", start: 0, end: 4 });
});
