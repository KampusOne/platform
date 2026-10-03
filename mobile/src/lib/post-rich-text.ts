export type PostToken = { text: string; kind: "text" | "link" | "hashtag" | "mention"; target?: string };

/** Links are HTTP(S) only; hashtags support Nigerian names and Unicode letters. */
export function postTokens(text: string): PostToken[] {
  text = typeof text === "string" ? text : "";
  const pattern = /https?:\/\/[^\s<>]+|www\.[^\s<>]+|#[\p{L}\p{M}\p{N}_]+|@[a-zA-Z0-9_]{1,30}/giu;
  const tokens: PostToken[] = [];
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index!;
    const raw = match[0];
    if ((raw.startsWith("#") || raw.startsWith("@")) && at > 0 && /[\p{L}\p{M}\p{N}_/]/u.test(text[at - 1]!)) continue;
    let value = raw;
    let target: string | undefined;
    if (!raw.startsWith("#") && !raw.startsWith("@")) {
      value = raw.replace(/[.,!?;:]+$/u, "");
      // Preserve balanced parentheses in article links, strip sentence wrappers.
      while (value.endsWith(")") && (value.match(/\)/g)?.length ?? 0) > (value.match(/\(/g)?.length ?? 0)) value = value.slice(0, -1);
      try {
        const url = new URL(value.startsWith("www.") ? `https://${value}` : value);
        if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) continue;
        target = url.href;
      } catch { continue; }
    }
    if (at > start) tokens.push({ text: text.slice(start, at), kind: "text" });
    tokens.push({ text: value, kind: raw.startsWith("#") ? "hashtag" : raw.startsWith("@") ? "mention" : "link", target: target ?? raw });
    start = at + value.length;
  }
  if (start < text.length) tokens.push({ text: text.slice(start), kind: "text" });
  return tokens;
}

/** Collapse copy only, with a bound for both long paragraphs and many short lines. */
export function postExcerpt(text: string, maxCharacters = 220, maxLines = 4): { text: string; collapsed: boolean } {
  text = typeof text === "string" ? text : "";
  const lineEnd = text.split("\n").slice(0, maxLines).join("\n").length;
  const limit = Math.min(maxCharacters, lineEnd);
  if (text.length <= limit) return { text, collapsed: false };
  let end = limit;
  // Never render a chopped URL or hashtag as a working link.
  const prefix = text.slice(0, end);
  const lastWhitespace = prefix.search(/\s+\S*$/u);
  if (lastWhitespace > end * 0.65) end = lastWhitespace;
  return { text: text.slice(0, end).trimEnd() + "…", collapsed: true };
}

export function activeHashtag(text: string, cursor = text.length) {
  text = typeof text === "string" ? text : "";
  cursor = Number.isFinite(cursor) ? Math.max(0, Math.min(text.length, cursor)) : text.length;
  const match = text.slice(0, cursor).match(/(?:^|\s)#([\p{L}\p{M}\p{N}_]*)$/u);
  return match ? { query: match[1]!, start: cursor - match[1]!.length - 1, end: cursor } : null;
}
