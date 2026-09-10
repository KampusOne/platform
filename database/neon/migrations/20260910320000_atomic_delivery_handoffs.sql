begin;

create or replace function app_private.reserve_delivery_job(
  p_job_id uuid,
  p_rider_profile_id uuid
) returns table (id uuid, university_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  selected_profile public.agent_profiles%rowtype;
  selected_presence public.rider_presence%rowtype;
  selected_job public.delivery_jobs%rowtype;
begin
  select profiles.* into selected_profile
  from public.agent_profiles profiles
  where profiles.id = p_rider_profile_id
    and profiles.agent_type = 'RIDER'
    and profiles.status = 'ACTIVE';
  if not found then
    raise exception using errcode = 'P0002', message = 'RIDER_PROFILE_UNAVAILABLE';
  end if;

  select presence.* into selected_presence
  from public.rider_presence presence
  where presence.rider_profile_id = p_rider_profile_id
  for update;
  if not found or not selected_presence.online
    or selected_presence.capacity_status <> 'AVAILABLE' then
    raise exception using errcode = 'P0001', message = 'RIDER_NOT_AVAILABLE';
  end if;

  if exists (
    select 1 from public.delivery_jobs jobs
    where jobs.rider_profile_id = p_rider_profile_id
      and jobs.status in ('RESERVED', 'PICKED_UP')
  ) then
    update public.rider_presence set capacity_status = 'AT_CAPACITY', updated_at = now()
    where rider_profile_id = p_rider_profile_id;
    raise exception using errcode = 'P0001', message = 'RIDER_AT_CAPACITY';
  end if;

  select jobs.* into selected_job
  from public.delivery_jobs jobs
  where jobs.id = p_job_id
    and jobs.university_id = selected_profile.university_id
    and jobs.status = 'AVAILABLE'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'DELIVERY_UNAVAILABLE';
  end if;

  update public.delivery_jobs
  set rider_profile_id = p_rider_profile_id, status = 'RESERVED',
      reserved_at = now(), updated_at = now()
  where delivery_jobs.id = selected_job.id;

  update public.rider_presence
  set capacity_status = 'AT_CAPACITY', last_seen_at = now(), updated_at = now()
  where rider_profile_id = p_rider_profile_id;

  return query select selected_job.id, selected_job.university_id;
end;
$$;

create or replace function app_private.confirm_delivery_pickup(
  p_job_id uuid,
  p_rider_profile_id uuid,
  p_actor_user_id uuid,
  p_code_hash text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  selected_job public.delivery_jobs%rowtype;
  order_status text;
begin
  select jobs.* into selected_job
  from public.delivery_jobs jobs
  where jobs.id = p_job_id
    and jobs.rider_profile_id = p_rider_profile_id
    and jobs.status = 'RESERVED'
  for update;
  if not found then return 'INVALID_STATE'; end if;

  if selected_job.pickup_code_attempts >= 5 or selected_job.code_expires_at <= now() then
    return 'LOCKED';
  end if;
  if selected_job.pickup_code_hash <> p_code_hash then
    update public.delivery_jobs
    set pickup_code_attempts = pickup_code_attempts + 1, updated_at = now()
    where delivery_jobs.id = selected_job.id;
    if selected_job.pickup_code_attempts + 1 >= 5 then return 'LOCKED'; end if;
    return 'INCORRECT';
  end if;

  select orders.status into order_status from public.orders orders
  where orders.id = selected_job.order_id for update;
  if order_status <> 'READY' then return 'ORDER_NOT_READY'; end if;

  update public.delivery_jobs set status = 'PICKED_UP', picked_up_at = now(), updated_at = now()
  where delivery_jobs.id = selected_job.id;
  update public.orders set status = 'IN_DELIVERY', updated_at = now()
  where orders.id = selected_job.order_id;
  insert into public.delivery_events (delivery_job_id, actor_user_id, event_type)
  values (selected_job.id, p_actor_user_id, 'PICKUP_CODE_VERIFIED');
  return 'PICKED_UP';
end;
$$;

create or replace function app_private.confirm_delivery_completion(
  p_job_id uuid,
  p_rider_profile_id uuid,
  p_actor_user_id uuid,
  p_code_hash text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  selected_job public.delivery_jobs%rowtype;
  order_status text;
begin
  select jobs.* into selected_job
  from public.delivery_jobs jobs
  where jobs.id = p_job_id
    and jobs.rider_profile_id = p_rider_profile_id
    and jobs.status = 'PICKED_UP'
  for update;
  if not found then return 'INVALID_STATE'; end if;

  if selected_job.delivery_code_attempts >= 5 or selected_job.code_expires_at <= now() then
    return 'LOCKED';
  end if;
  if selected_job.delivery_code_hash <> p_code_hash then
    update public.delivery_jobs
    set delivery_code_attempts = delivery_code_attempts + 1, updated_at = now()
    where delivery_jobs.id = selected_job.id;
    if selected_job.delivery_code_attempts + 1 >= 5 then return 'LOCKED'; end if;
    return 'INCORRECT';
  end if;

  select orders.status into order_status from public.orders orders
  where orders.id = selected_job.order_id for update;
  if order_status <> 'IN_DELIVERY' then return 'INVALID_STATE'; end if;

  update public.delivery_jobs
  set status = 'DELIVERED', delivered_at = now(), earnings_state = 'PENDING', updated_at = now()
  where delivery_jobs.id = selected_job.id;
  update public.orders
  set status = 'DELIVERED', completed_at = now(), earnings_state = 'PENDING', updated_at = now()
  where orders.id = selected_job.order_id;
  insert into public.delivery_events (delivery_job_id, actor_user_id, event_type)
  values (selected_job.id, p_actor_user_id, 'DELIVERY_CODE_VERIFIED');
  update public.rider_presence
  set capacity_status = 'AVAILABLE', last_seen_at = now(), updated_at = now()
  where rider_profile_id = p_rider_profile_id;
  return 'DELIVERED';
end;
$$;

revoke all on function app_private.reserve_delivery_job(uuid, uuid) from public;
revoke all on function app_private.confirm_delivery_pickup(uuid, uuid, uuid, text) from public;
revoke all on function app_private.confirm_delivery_completion(uuid, uuid, uuid, text) from public;

commit;
