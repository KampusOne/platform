import type { FeedComment } from "./feed-social";

export type CommentDeletion = { retained: boolean; reply_count: number };

export function commentsPath(postId: string, parentCommentId: string | null = null, cursor: string | null = null): string {
  const query = [parentCommentId ? `parentCommentId=${encodeURIComponent(parentCommentId)}` : "", cursor ? `cursor=${encodeURIComponent(cursor)}` : ""].filter(Boolean).join("&");
  return `/v1/student/feed/${encodeURIComponent(postId)}/comments${query ? `?${query}` : ""}`;
}

// Never merge a response for a different branch into this thread.
export function mergeComments(current: FeedComment[], incoming: FeedComment[], parentCommentId: string | null): FeedComment[] {
  const items = new Map<string, FeedComment>();
  for (const comment of [...current, ...incoming]) {
    if ((comment.parent_comment_id ?? null) === parentCommentId) items.set(comment.id, comment);
  }
  return [...items.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export function deleteFromThread(comments: FeedComment[], id: string, result: CommentDeletion): FeedComment[] {
  return comments.flatMap((comment) => {
    if (comment.id !== id) return [comment];
    if (!result.retained) return [];
    return [{ ...comment, body: "", author_name: "Comment deleted", author_image_url: null, author_username: null,
      author_verified: false, can_delete: false, is_deleted: true, reply_count: result.reply_count }];
  });
}
