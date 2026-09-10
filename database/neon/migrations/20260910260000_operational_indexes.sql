begin;

create index if not exists tutorial_bookings_window_capacity_idx
  on public.tutorial_bookings (availability_window_id, status, payment_expires_at);

create index if not exists inventory_reservations_expiry_idx
  on public.inventory_reservations (expires_at, order_id)
  where status = 'HELD';

create index if not exists payment_provider_events_recent_idx
  on public.payment_provider_events (state, received_at desc);

commit;
