begin;
alter table public.student_alarms add column if not exists fires_at timestamptz;
create index if not exists alarms_one_time_idx on public.student_alarms(user_id,fires_at) where fires_at is not null;
commit;
