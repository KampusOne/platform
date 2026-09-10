begin;

create or replace function app_private.check_and_consume_email_verification(
  p_token_id uuid,
  p_token_hash text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  selected public.verification_tokens%rowtype;
begin
  select tokens.* into selected
  from public.verification_tokens tokens
  where tokens.id = p_token_id and tokens.type::text = 'EMAIL_VERIFICATION'
  for update;

  if not found then return 'INVALID'; end if;
  if selected.used_at is not null then return 'USED'; end if;
  if selected.expires_at <= now() then return 'EXPIRED'; end if;
  if selected.attempts >= 5 then return 'LOCKED'; end if;

  if selected.token_hash is distinct from p_token_hash then
    update public.verification_tokens
    set attempts = attempts + 1
    where id = selected.id;
    if selected.attempts + 1 >= 5 then return 'LOCKED'; end if;
    return 'INCORRECT';
  end if;

  update public.verification_tokens
  set used_at = coalesce(used_at, now())
  where user_id = selected.user_id and type::text = 'EMAIL_VERIFICATION' and used_at is null;
  update public.users
  set email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
  where id = selected.user_id;
  update public.profiles
  set onboarding_step = 'PROFILE', updated_at = now()
  where user_id = selected.user_id;
  return 'VERIFIED';
end;
$$;

create or replace function app_private.check_and_consume_password_reset(
  p_token_id uuid,
  p_token_hash text,
  p_password_hash text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  selected public.verification_tokens%rowtype;
begin
  select tokens.* into selected
  from public.verification_tokens tokens
  where tokens.id = p_token_id and tokens.type::text = 'PASSWORD_RESET'
  for update;

  if not found then return 'INVALID'; end if;
  if selected.used_at is not null then return 'USED'; end if;
  if selected.expires_at <= now() then return 'EXPIRED'; end if;
  if selected.attempts >= 5 then return 'LOCKED'; end if;

  if selected.token_hash is distinct from p_token_hash then
    update public.verification_tokens
    set attempts = attempts + 1
    where id = selected.id;
    if selected.attempts + 1 >= 5 then return 'LOCKED'; end if;
    return 'INCORRECT';
  end if;

  update public.verification_tokens
  set used_at = coalesce(used_at, now())
  where user_id = selected.user_id and type::text = 'PASSWORD_RESET' and used_at is null;
  update public.users
  set password_hash = p_password_hash, updated_at = now()
  where id = selected.user_id;
  update public.refresh_tokens
  set revoked_at = coalesce(revoked_at, now())
  where user_id = selected.user_id;
  return 'UPDATED';
end;
$$;

revoke all on function app_private.check_and_consume_email_verification(uuid, text) from public;
revoke all on function app_private.check_and_consume_password_reset(uuid, text, text) from public;

commit;
