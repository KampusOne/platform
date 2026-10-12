-- Optional academic context for the public waitlist. Existing consent and RLS stay in place.
begin;
alter table app_private.website_waitlist
  add column if not exists faculty text not null default '' check(char_length(faculty)<=180),
  add column if not exists department text not null default '' check(char_length(department)<=180),
  add column if not exists current_level text not null default '' check(char_length(current_level)<=80);
commit;
