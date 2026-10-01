-- Self-rolling-back database acceptance. No payment provider is contacted.
-- A nested exception removes every fixture; explicit constraint evaluation also
-- exercises PostgreSQL's deferred journal checks before fixture rollback.
do $platform_finance_acceptance$
declare
  campus uuid;
  account_user uuid;
  fixture_key text := 'platform-acceptance:' || gen_random_uuid()::text;
  receipt_reference text := 'platform-receipt:' || gen_random_uuid()::text;
  resource uuid := gen_random_uuid();
  paid_at timestamptz := now();
  lines jsonb;
  first_journal uuid;
  duplicate_journal uuid;
  first_receipt uuid;
  duplicate_receipt uuid;
  prior_balance bigint;
  blocked boolean;
  completed boolean := false;
begin
  select p.university_id, p.user_id into campus, account_user
  from public.profiles p join public.users u on u.id = p.user_id
  where p.deleted_at is null and u.deleted_at is null and u.status = 'ACTIVE'
    and p.university_id is not null
  order by p.created_at limit 1;
  if campus is null or account_user is null then
    raise exception 'PLATFORM_ACCEPTANCE_REQUIRES_ONE_ACTIVE_STUDENT';
  end if;
  prior_balance := app_private.finance_balance(campus, account_user, 'RIDER_AVAILABLE');
  begin
    lines := jsonb_build_array(
      jsonb_build_object('code','PAYSTACK_CLEARING','type','ASSET','direction','DEBIT','amount',10000),
      jsonb_build_object('code','RIDER_AVAILABLE','type','LIABILITY','owner',account_user,'direction','CREDIT','amount',10000)
    );
    first_journal := app_private.post_finance_journal(campus, 'ACCEPTANCE_FIXTURE', fixture_key, fixture_key, 'Self-cleaning acceptance', lines);
    duplicate_journal := app_private.post_finance_journal(campus, 'ACCEPTANCE_FIXTURE', fixture_key, fixture_key, 'Self-cleaning acceptance', lines);
    if first_journal is distinct from duplicate_journal
      or (select count(*) from public.ledger_lines where transaction_id = first_journal) <> 2
      or app_private.finance_balance(campus, account_user, 'RIDER_AVAILABLE') <> prior_balance + 10000 then
      raise exception 'PLATFORM_JOURNAL_IDEMPOTENCY_OR_BALANCE_FAILED';
    end if;
    blocked := false;
    begin
      perform app_private.post_finance_journal(campus, 'ACCEPTANCE_FIXTURE', fixture_key, fixture_key, 'Changed payload', lines);
    exception when others then
      if sqlerrm = 'JOURNAL_IDEMPOTENCY_CONFLICT' then blocked := true; else raise; end if;
    end;
    if not blocked then raise exception 'PLATFORM_JOURNAL_PAYLOAD_CONFLICT_NOT_BLOCKED'; end if;
    blocked := false;
    begin
      update public.ledger_transactions set description = 'Forbidden fixture mutation' where id = first_journal;
    exception when others then
      if sqlerrm = 'ledger_transactions is append-only' then blocked := true; else raise; end if;
    end;
    if not blocked then raise exception 'PLATFORM_JOURNAL_MUTATION_NOT_BLOCKED'; end if;
    first_receipt := app_private.record_verified_paystack_receipt(campus, receipt_reference, 'KIRA_SUBSCRIPTION', resource, 600000, 19000, paid_at);
    duplicate_receipt := app_private.record_verified_paystack_receipt(campus, receipt_reference, 'KIRA_SUBSCRIPTION', resource, 600000, 19000, paid_at);
    if first_receipt is distinct from duplicate_receipt
      or (select count(*) from app_private.verified_paystack_receipts where provider_reference = receipt_reference) <> 1 then
      raise exception 'PLATFORM_RECEIPT_IDEMPOTENCY_FAILED';
    end if;
    blocked := false;
    begin
      perform app_private.record_verified_paystack_receipt(campus, receipt_reference, 'KIRA_SUBSCRIPTION', resource, 600100, 19000, paid_at);
    exception when others then
      if sqlerrm = 'RECEIPT_IDEMPOTENCY_CONFLICT' then blocked := true; else raise; end if;
    end;
    if not blocked then raise exception 'PLATFORM_RECEIPT_AMOUNT_CONFLICT_NOT_BLOCKED'; end if;
    set constraints all immediate;
    completed := true;
    raise exception using errcode = 'P0399', message = 'ROLLBACK_PLATFORM_ACCEPTANCE_FIXTURES';
  exception when sqlstate 'P0399' then
    if not completed then raise; end if;
  end;
  if exists (select 1 from public.ledger_transactions where idempotency_key = fixture_key)
    or exists (select 1 from app_private.verified_paystack_receipts where provider_reference = receipt_reference)
    or app_private.finance_balance(campus, account_user, 'RIDER_AVAILABLE') <> prior_balance then
    raise exception 'PLATFORM_ACCEPTANCE_FIXTURE_CLEANUP_FAILED';
  end if;
end;
$platform_finance_acceptance$;
