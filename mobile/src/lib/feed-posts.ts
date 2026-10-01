import { Platform } from "react-native";
import { sharedLink } from "./shared-links";
import { shareItem } from "./share-content";
import { clearApiCache } from "@/src/lib/api";

export type FeedPostData = {
  id: string;
  category: string;
  title: string;
  summary: string;
  body: string;
  image_url: string | null;
  media_width?: number | null;
  media_height?: number | null;
  urgent: boolean;
  sponsored: boolean;
  published_at: string;
  correction_note: string | null;
  source_name: string;
  source_verified: boolean;
  bookmarked: boolean;
  can_delete?: boolean;
  source_username?: string | null;
};

// Production links never inherit a preview deployment hostname.
const postIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const deletedPosts = new Set<string>();
let pendingPost: string | null = null;
const pendingKey = "kampusone.pending-post";

export function validPostId(value: unknown): value is string {
  return typeof value === "string" && postIdPattern.test(value);
}

export function postUrl(id: string): string {
  if (!validPostId(id)) throw new Error("This post link is not valid.");
  return sharedLink("post", id);
}

export function markPostDeleted(id: string): void {
  deletedPosts.add(id);
  clearApiCache();
}

export function wasPostDeleted(id: string): boolean {
  return deletedPosts.has(id);
}

export function rememberPostLink(id: string): void {
  if (!validPostId(id)) return;
  pendingPost = id;
  try {
    if (Platform.OS === "web" && typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(pendingKey, id);
    }
  } catch { /* In-memory return navigation still works when storage is blocked. */ }
}

export function pendingPostLink(): string | null {
  try {
    if (!pendingPost && Platform.OS === "web" && typeof sessionStorage !== "undefined") {
      pendingPost = sessionStorage.getItem(pendingKey);
    }
  } catch { /* Storage can be disabled in a private browser session. */ }
  return validPostId(pendingPost) ? pendingPost : null;
}

export function clearPendingPostLink(): void {
  pendingPost = null;
  try {
    if (Platform.OS === "web" && typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(pendingKey);
    }
  } catch { /* Do not block reading a post because storage is unavailable. */ }
}

// A false result opens a selectable-link dialog instead of claiming a copy succeeded.
export async function copyPostLink(id: string): Promise<boolean> {
  const url = postUrl(id);
  if (Platform.OS !== "web" || typeof document === "undefined") return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch { /* Try the browser's selection-based fallback below. */ }
  const previous = document.activeElement as HTMLElement | null;
  const input = document.createElement("textarea");
  input.value = url;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    input.remove();
    previous?.focus?.();
  }
}

export async function sharePostLink(post: Pick<FeedPostData, "id" | "title"> & Partial<Pick<FeedPostData, "source_name" | "source_username">>): Promise<"shared" | "copied" | "cancelled" | "manual"> {
  const author = post.source_username ? `@${post.source_username}` : post.source_name;
  const message = `Check out this post${author ? ` by ${author}` : ""} on KampusOne.`;
  return shareItem("post", post.id, post.title || "KampusOne post", message);
}
