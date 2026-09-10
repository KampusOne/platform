begin;

create table if not exists app_private.request_rate_limits (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 1 check (attempts > 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash)
);

create or replace function app_private.consume_request_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer
) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  selected app_private.request_rate_limits%rowtype;
begin
  if p_limit < 1 or p_window_seconds < 1 or p_block_seconds < 1 then
    raise exception using errcode = '22023', message = 'INVALID_RATE_LIMIT_CONFIGURATION';
  end if;

  select limits.* into selected
  from app_private.request_rate_limits limits
  where limits.scope = p_scope and limits.key_hash = p_key_hash
  for update;

  if not found then
    insert into app_private.request_rate_limits (scope, key_hash)
    values (p_scope, p_key_hash);
    return true;
  end if;

  if selected.blocked_until is not null and selected.blocked_until > now() then
    update app_private.request_rate_limits set updated_at = now()
    where scope = p_scope and key_hash = p_key_hash;
    return false;
  end if;

  if selected.window_started_at <= now() - pg_catalog.make_interval(secs => p_window_seconds) then
    update app_private.request_rate_limits
    set window_started_at = now(), attempts = 1, blocked_until = null, updated_at = now()
    where scope = p_scope and key_hash = p_key_hash;
    return true;
  end if;

  if selected.attempts >= p_limit then
    update app_private.request_rate_limits
    set blocked_until = now() + pg_catalog.make_interval(secs => p_block_seconds), updated_at = now()
    where scope = p_scope and key_hash = p_key_hash;
    return false;
  end if;

  update app_private.request_rate_limits
  set attempts = attempts + 1, updated_at = now()
  where scope = p_scope and key_hash = p_key_hash;
  return true;
end;
$$;

create or replace function app_private.clear_request_rate_limit(
  p_scope text,
  p_key_hash text
) returns void
language sql
set search_path = ''
as $$
  delete from app_private.request_rate_limits
  where scope = p_scope and key_hash = p_key_hash;
$$;

create or replace function app_private.cleanup_request_rate_limits()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from app_private.request_rate_limits
  where updated_at < now() - interval '7 days'
    and (blocked_until is null or blocked_until < now());
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function app_private.consume_request_rate_limit(text, text, integer, integer, integer) from public;
revoke all on function app_private.clear_request_rate_limit(text, text) from public;
revoke all on function app_private.cleanup_request_rate_limits() from public;

commit;
