type PostTextFields = {
  title?: string | null;
  summary?: string | null;
  body?: string | null;
};

/** Keep complete copy once, even when the API also supplies generated excerpts. */
export function getFeedPostText(post: PostTextFields): { title: string; paragraphs: string[] } {
  const fields = (["title", "summary", "body"] as const).map((kind) => {
    const text = (post[kind] ?? "").trim();
    return { kind, text, normalized: text.replace(/\s+/gu, " ") };
  }).filter((field) => field.text.length > 0);

  const visible = fields.filter((field, index) => !fields.some((other, otherIndex) => {
    if (index === otherIndex) return false;
    // Prefer the body over an identical summary/title, without changing its formatting.
    if (other.normalized === field.normalized) return otherIndex > index;
    // A generated title/summary may just be the beginning of the complete text.
    return other.normalized.length > field.normalized.length && other.normalized.startsWith(field.normalized);
  }));

  return {
    title: visible.find((field) => field.kind === "title")?.text ?? "",
    paragraphs: visible.filter((field) => field.kind !== "title").map((field) => field.text),
  };
}
