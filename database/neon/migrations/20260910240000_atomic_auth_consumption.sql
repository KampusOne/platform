begin;

create or replace function app_private.consume_email_verification(
  p_token_id uuid
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  selected public.verification_tokens%rowtype;
begin
  select * into selected from public.verification_tokens tokens
  where tokens.id = p_token_id and tokens.type::text = 'EMAIL_VERIFICATION'
  for update;

  if not found or selected.used_at is not null or selected.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'VERIFICATION_ALREADY_CONSUMED';
  end if;

  update public.verification_tokens set used_at = now() where id = selected.id;
  update public.users set email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
    where id = selected.user_id;
  update public.profiles set onboarding_step = 'PROFILE', updated_at = now()
    where user_id = selected.user_id;
  return selected.user_id;
end;
$$;

create or replace function app_private.consume_password_reset(
  p_token_id uuid,
  p_password_hash text
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  selected public.verification_tokens%rowtype;
begin
  select * into selected from public.verification_tokens tokens
  where tokens.id = p_token_id and tokens.type::text = 'PASSWORD_RESET'
  for update;

  if not found or selected.used_at is not null or selected.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'RESET_ALREADY_CONSUMED';
  end if;

  update public.verification_tokens set used_at = now() where id = selected.id;
  update public.users set password_hash = p_password_hash, updated_at = now()
    where id = selected.user_id;
  update public.refresh_tokens set revoked_at = coalesce(revoked_at, now())
    where user_id = selected.user_id;
  return selected.user_id;
end;
$$;

revoke all on function app_private.consume_email_verification(uuid) from public;
revoke all on function app_private.consume_password_reset(uuid, text) from public;
revoke all on function app_private.cancel_vendor_order(uuid, uuid) from public;
revoke all on function app_private.expire_stale_commerce() from public;

commit;
