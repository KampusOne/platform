begin;
-- Indexes are additive. Missing language metadata remains untagged, never inferred.
create index if not exists feed_published_text_search_idx on public.feed_posts
 using gin(to_tsvector('simple',coalesce(title,'')||' '||coalesce(summary,'')||' '||coalesce(body,'')))where status in('PUBLISHED','CORRECTED');
create index if not exists feed_live_reply_body_search_idx on public.feed_comments
 using gin(to_tsvector('simple',coalesce(body,'')))where deleted_at is null;
create index if not exists profile_username_discovery_idx on public.profiles(lower(username)text_pattern_ops)where deleted_at is null;
commit;
