begin;

create or replace function app_private.request_agent_payout(
  p_request_id uuid,
  p_agent_profile_id uuid,
  p_requested_by_user_id uuid,
  p_amount_kobo bigint
) returns table (id uuid, status text, university_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  selected_profile public.agent_profiles%rowtype;
  bank_state text;
  earned_amount bigint := 0;
  committed_amount bigint := 0;
begin
  if p_amount_kobo < 10000 then
    raise exception using errcode = 'P0001', message = 'PAYOUT_AMOUNT_TOO_SMALL';
  end if;

  select profiles.* into selected_profile
  from public.agent_profiles profiles
  where profiles.id = p_agent_profile_id
    and profiles.user_id = p_requested_by_user_id
    and profiles.status = 'ACTIVE'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PAYOUT_PROFILE_UNAVAILABLE';
  end if;

  select applications.bank_status into bank_state
  from public.agent_applications applications
  where applications.id = selected_profile.application_id;

  if bank_state is distinct from 'VERIFIED' then
    raise exception using errcode = 'P0001', message = 'PAYOUT_ACCOUNT_UNVERIFIED';
  end if;

  if selected_profile.agent_type = 'TUTOR' then
    select coalesce(sum(bookings.amount_kobo), 0)::bigint into earned_amount
    from public.tutorial_bookings bookings
    join public.tutorial_listings listings on listings.id = bookings.listing_id
    where listings.tutor_profile_id = selected_profile.id
      and bookings.earnings_state = 'AVAILABLE';
  elsif selected_profile.agent_type = 'VENDOR' then
    select coalesce(sum(orders.subtotal_kobo), 0)::bigint into earned_amount
    from public.orders orders
    where orders.vendor_profile_id = selected_profile.id
      and orders.earnings_state = 'AVAILABLE';
  elsif selected_profile.agent_type = 'RIDER' then
    select coalesce(sum(jobs.rider_earning_kobo), 0)::bigint into earned_amount
    from public.delivery_jobs jobs
    where jobs.rider_profile_id = selected_profile.id
      and jobs.earnings_state = 'AVAILABLE';
  end if;

  select coalesce(sum(requests.amount_kobo), 0)::bigint into committed_amount
  from public.payout_requests requests
  where requests.agent_profile_id = selected_profile.id
    and requests.status in ('REQUESTED', 'IN_REVIEW', 'APPROVED', 'PROCESSING', 'FAILED', 'PAID');

  if earned_amount - committed_amount < p_amount_kobo then
    raise exception using errcode = 'P0001', message = 'PAYOUT_BALANCE_INSUFFICIENT';
  end if;

  insert into public.payout_requests (
    id, university_id, agent_profile_id, requested_by_user_id, amount_kobo
  ) values (
    p_request_id, selected_profile.university_id, selected_profile.id,
    p_requested_by_user_id, p_amount_kobo
  );

  return query select p_request_id, 'REQUESTED'::text, selected_profile.university_id;
end;
$$;

revoke all on function app_private.request_agent_payout(uuid, uuid, uuid, bigint) from public;

commit;
