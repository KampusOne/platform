-- Additive migration. Apply and verify before deploying feed-conversation routes.
-- Historical audience values are deliberately NOT widened.
ALTER TABLE public.feed_posts ADD COLUMN IF NOT EXISTS quoted_post_id uuid REFERENCES public.feed_posts(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feed_posts_quote_not_self' AND conrelid = 'public.feed_posts'::regclass) THEN
    ALTER TABLE public.feed_posts ADD CONSTRAINT feed_posts_quote_not_self CHECK (quoted_post_id IS NULL OR quoted_post_id <> id);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.feed_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid NOT NULL REFERENCES public.universities(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.feed_posts(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  client_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (author_user_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS feed_comments_visible_page ON public.feed_comments(post_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS public.feed_reposts (
  post_id uuid NOT NULL REFERENCES public.feed_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  university_id uuid NOT NULL REFERENCES public.universities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS feed_reposts_recent ON public.feed_reposts(post_id, created_at DESC, user_id);
CREATE INDEX IF NOT EXISTS feed_posts_quotes ON public.feed_posts(quoted_post_id) WHERE quoted_post_id IS NOT NULL AND status IN ('PUBLISHED','CORRECTED');
CREATE INDEX IF NOT EXISTS feed_posts_global_page ON public.feed_posts(published_at DESC, id DESC) WHERE status IN ('PUBLISHED','CORRECTED') AND audience->>'visibility' = 'GLOBAL' AND audience->>'studentPost' = 'true';
ALTER TABLE public.feed_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_reposts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.feed_comments, public.feed_reposts FROM PUBLIC;
