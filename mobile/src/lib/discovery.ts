import type { SocialFeedPost } from "./feed-social";
export const searchTabs = ["TOP", "LATEST", "PEOPLE", "MEDIA"] as const;
export type SearchTab = (typeof searchTabs)[number];
export type SearchFilters = {
  from: string;
  since: string;
  until: string;
  language: string;
  activity: string;
  excludeReplies: boolean;
};
export const emptySearchFilters: SearchFilters = {
  from: "",
  since: "",
  until: "",
  language: "ANY",
  activity: "ALL",
  excludeReplies: false,
};
export const languages = [
  ["ANY", "Any language"],
  ["en", "English"],
  ["pcm", "Nigerian Pidgin"],
  ["yo", "Yorùbá"],
  ["ig", "Igbo"],
  ["ha", "Hausa"],
  ["und", "Unspecified"],
] as const;
export const activities = [
  ["ALL", "Everyone"],
  ["FOLLOWING", "People I follow"],
  ["LIKED", "Posts I liked"],
  ["REPLIED", "Posts I replied to"],
  ["REPOSTED", "Posts I reposted"],
] as const;
export type SearchResult =
  | { kind: "POST"; id: string; post: SocialFeedPost }
  | {
      kind: "PERSON";
      id: string;
      name: string;
      username: string | null;
      avatarUrl: string | null;
      bio: string | null;
      university: string | null;
      followed: boolean;
      verified: boolean;
    }
  | {
      kind: "REPLY";
      id: string;
      postId: string;
      userId: string;
      name: string;
      username: string | null;
      avatarUrl: string | null;
      body: string;
      createdAt: string;
      parentTitle: string;
    };
export type SearchPage = {
  ready: boolean;
  results: SearchResult[];
  nextCursor: string | null;
  tab: SearchTab;
};
export function searchFilterError(filters: SearchFilters): string {
  if (filters.from && !/^@?[A-Za-z0-9_.]{1,40}$/.test(filters.from.trim()))
    return "Enter a username in From, such as @ade.";
  for (const value of [filters.since, filters.until])
    if (
      value &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      return "Use a valid date in YYYY-MM-DD format.";
  if (filters.since && filters.until && filters.since > filters.until)
    return "The start date must come before the end date.";
  return "";
}
export function discoveryPath(
  q: string,
  tab: SearchTab,
  filters: SearchFilters,
  cursor?: string | null,
) {
  const params = new URLSearchParams({
    q: q.trim(),
    tab: q.trim().startsWith("@") ? "PEOPLE" : tab,
  });
  if (params.get("tab") !== "PEOPLE") {
    for (const key of [
      "from",
      "since",
      "until",
      "language",
      "activity",
    ] as const)
      if (filters[key]) params.set(key, filters[key].trim());
    params.set("excludeReplies", String(filters.excludeReplies));
  }
  if (cursor) params.set("cursor", cursor);
  return "/v1/discovery/search?" + params;
}
export function mergeSearchResults(old: SearchResult[], next: SearchResult[]) {
  const seen = new Set(old.map((r) => `${r.kind}:${r.id}`));
  return [
    ...old,
    ...next.filter((r) => {
      const key = `${r.kind}:${r.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
}
