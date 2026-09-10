begin;

drop function if exists app_private.create_tutorial_booking(uuid, uuid, uuid, uuid, timestamptz);

create or replace function app_private.create_tutorial_booking(
  p_booking_id uuid,
  p_university_id uuid,
  p_listing_id uuid,
  p_availability_window_id uuid,
  p_student_user_id uuid
) returns table (id uuid, amount_kobo integer, scheduled_for timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  selected_listing public.tutorial_listings%rowtype;
  selected_window public.tutorial_availability_windows%rowtype;
  active_count integer;
begin
  select * into selected_listing from public.tutorial_listings listings
  where listings.id = p_listing_id and listings.university_id = p_university_id
    and listings.status = 'PUBLISHED'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'TUTORIAL_UNAVAILABLE';
  end if;

  select * into selected_window from public.tutorial_availability_windows windows
  where windows.id = p_availability_window_id and windows.listing_id = selected_listing.id
    and windows.status = 'OPEN' and windows.starts_at > now()
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'TUTORIAL_WINDOW_UNAVAILABLE';
  end if;

  if exists (
    select 1 from public.tutorial_bookings bookings
    where bookings.availability_window_id = selected_window.id
      and bookings.student_user_id = p_student_user_id
      and (
        bookings.status in ('CONFIRMED', 'COMPLETED') or
        (bookings.status = 'PENDING_PAYMENT' and bookings.payment_expires_at > now())
      )
  ) then
    raise exception using errcode = 'P0001', message = 'TUTORIAL_ALREADY_BOOKED';
  end if;

  select count(*)::integer into active_count
  from public.tutorial_bookings bookings
  where bookings.availability_window_id = selected_window.id and (
    bookings.status in ('CONFIRMED', 'COMPLETED') or
    (bookings.status = 'PENDING_PAYMENT' and bookings.payment_expires_at > now())
  );
  if active_count >= least(selected_window.capacity, selected_listing.capacity) then
    raise exception using errcode = 'P0001', message = 'TUTORIAL_FULL';
  end if;

  insert into public.tutorial_bookings (
    id, university_id, listing_id, availability_window_id, student_user_id,
    amount_kobo, scheduled_for, payment_expires_at
  ) values (
    p_booking_id, p_university_id, selected_listing.id, selected_window.id,
    p_student_user_id, selected_listing.price_kobo, selected_window.starts_at,
    now() + interval '30 minutes'
  );

  return query select p_booking_id, selected_listing.price_kobo, selected_window.starts_at;
end;
$$;

revoke all on function app_private.create_tutorial_booking(uuid, uuid, uuid, uuid, uuid) from public;

commit;
