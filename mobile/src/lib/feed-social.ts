import type { FeedPostData } from "./feed-posts";

export type QuotedPost = Pick<FeedPostData, "id" | "title" | "summary" | "body" | "image_url" | "published_at" | "source_name" | "source_verified"> & { source_image_url?: string | null };
export type SocialFeedPost = FeedPostData & {
  social_enabled?: boolean;
  liked?: boolean;
  like_count?: number;
  visibility?: "PUBLIC" | "CAMPUS";
  source_image_url?: string | null;
  view_count?: number | null;
  comment_count?: number;
  repost_count?: number;
  reposted?: boolean;
  quoted_post_id?: string | null;
  quoted_post?: QuotedPost | null;
  activity_at?: string;
  repost_by?: { user_id: string; name: string } | null;
};
export type FeedComment = {
  liked?: boolean; like_count?: number;
  id: string; body: string; created_at: string; author_name: string;
  author_verified: boolean; can_delete: boolean;
  author_image_url?: string | null; author_username?: string | null;
  image_url?: string | null;
  parent_comment_id?: string | null; reply_count?: number; is_deleted?: boolean;
};
export type FeedPage = { posts: SocialFeedPost[]; nextCursor?: string | null };
export type CommentPage = { comments: FeedComment[]; nextCursor?: string | null; parentDeleted?: boolean };

export function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const items = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) items.set(item.id, item);
  return [...items.values()];
}
export function safeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}
