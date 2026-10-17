-- Recognition only: never changes identity verification, enrolment or permissions.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS public_badge_kind text NOT NULL DEFAULT 'STANDARD';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname='profiles_public_badge_kind_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_public_badge_kind_check CHECK (public_badge_kind IN ('STANDARD','ALUMNI'));
  END IF;
END $$;

-- Optional keys keep older clients compatible and make retries from the shared composer safe.
ALTER TABLE public.student_group_comments ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS student_group_comment_request_key ON public.student_group_comments(author_user_id,request_id);
