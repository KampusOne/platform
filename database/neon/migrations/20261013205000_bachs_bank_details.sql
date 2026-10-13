begin;
-- Historical Paystack destinations and receipts remain pinned to their provider.
alter table app_private.payout_account_setups add column provider text not null default 'PAYSTACK' check(provider in('PAYSTACK','BACHS')),
 add column connected_account_id text check(connected_account_id is null or connected_account_id ~ '^acct_[A-Za-z0-9_-]{8,128}$'),
 add column bank_details_envelope jsonb;
alter table app_private.payout_account_setups drop constraint payout_account_setups_status_check;
alter table app_private.payout_account_setups add constraint payout_account_setups_status_check check(status in('RESOLVING','PENDING_PROVIDER','PENDING_REVIEW','APPROVED','REJECTED','FAILED','SUPERSEDED'));
alter table app_private.payout_account_setups add constraint bachs_payout_bank_sealed check(provider<>'BACHS' or status not in('PENDING_PROVIDER','PENDING_REVIEW','APPROVED') or
 (bank_details_envelope is not null and coalesce(bank_details_envelope->>'version'='1',false) and bank_details_envelope->>'nonce' is not null and bank_details_envelope->>'ciphertext' is not null and account_name is not null and account_last4 is not null));
alter table app_private.payout_account_setups add constraint bachs_destination_bound check(provider<>'BACHS' or status<>'APPROVED' or (connected_account_id is not null and recipient_code ~ '^pd_[A-Za-z0-9_-]{8,128}$'));

create function app_private.payout_setup_has_pending(p_profile uuid)returns boolean language plpgsql stable set search_path='' as $$
declare pending boolean;
begin
 if to_regclass('app_private.agent_payout_settlements') is not null and exists(select 1 from information_schema.columns where table_schema='app_private' and table_name='agent_payout_settlements' and column_name='failure_release_journal_id') then
  execute 'select exists(select 1 from public.payout_requests p left join app_private.agent_payout_settlements s on s.payout_id=p.id where p.agent_profile_id=$1 and p.status in(''REQUESTED'',''IN_REVIEW'',''APPROVED'',''PROCESSING'',''OTP_REQUIRED'',''FAILED'',''REQUIRES_REVIEW'') and s.failure_release_journal_id is null)' into pending using p_profile;
 else
  select exists(select 1 from public.payout_requests where agent_profile_id=p_profile and status in('REQUESTED','IN_REVIEW','APPROVED','PROCESSING','OTP_REQUIRED','FAILED','REQUIRES_REVIEW')) into pending;
 end if;
 return pending;
end;$$;
revoke all on function app_private.payout_setup_has_pending(uuid) from public;
create function app_private.guard_approved_bank_setup()returns trigger language plpgsql set search_path='' as $$
begin
 if old.status='APPROVED' and(old.user_id,old.agent_profile_id,old.application_id,old.institution_id,old.provider,old.bank_code,old.bank_name,old.account_name,old.account_last4,old.recipient_code,old.provider_mode,old.connected_account_id,old.bank_details_envelope)
 is distinct from(new.user_id,new.agent_profile_id,new.application_id,new.institution_id,new.provider,new.bank_code,new.bank_name,new.account_name,new.account_last4,new.recipient_code,new.provider_mode,new.connected_account_id,new.bank_details_envelope)
 then raise exception 'APPROVED_BANK_DETAILS_IMMUTABLE';end if;
 return new;
end;$$;
create trigger approved_bank_setup_sealed before update on app_private.payout_account_setups for each row execute function app_private.guard_approved_bank_setup();
revoke all on function app_private.guard_approved_bank_setup() from public;
commit;
