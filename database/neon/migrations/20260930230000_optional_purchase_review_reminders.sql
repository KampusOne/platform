begin;
create table if not exists app_private.purchase_review_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  university_id uuid not null references public.universities(id) on delete restrict,
  resource_type text not null check(resource_type in ('STORE_ORDER','TUTORIAL_BOOKING')),
  resource_id uuid not null,
  due_at timestamptz not null,
  state text not null default 'PENDING' check(state in ('PENDING','SHOWN','DISMISSED','REVIEWED')),
  notified_at timestamptz,
  shown_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(resource_type,resource_id)
);
create index if not exists purchase_review_reminders_due_idx
  on app_private.purchase_review_reminders(due_at,user_id) where state='PENDING';

create or replace function app_private.schedule_purchase_review_reminder() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_table_name='orders' then
    if new.status='DELIVERED' and (tg_op='INSERT' or old.status is distinct from new.status) then
      insert into app_private.purchase_review_reminders(user_id,university_id,resource_type,resource_id,due_at)
        values(new.buyer_user_id,new.university_id,'STORE_ORDER',new.id,
          coalesce(new.completed_at,now())+interval '3 hours') on conflict do nothing;
    end if;
  else
    if new.status='COMPLETED' and (tg_op='INSERT' or old.status is distinct from new.status) then
      insert into app_private.purchase_review_reminders(user_id,university_id,resource_type,resource_id,due_at)
        values(new.student_user_id,new.university_id,'TUTORIAL_BOOKING',new.id,now()+interval '3 hours') on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists orders_schedule_review_reminder on public.orders;
create trigger orders_schedule_review_reminder after insert or update of status on public.orders
  for each row execute function app_private.schedule_purchase_review_reminder();
drop trigger if exists tutorials_schedule_review_reminder on public.tutorial_bookings;
create trigger tutorials_schedule_review_reminder after insert or update of status on public.tutorial_bookings
  for each row execute function app_private.schedule_purchase_review_reminder();

create or replace function app_private.close_purchase_review_reminder() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_table_name='product_reviews' then
    update app_private.purchase_review_reminders set state='REVIEWED',updated_at=now()
      where resource_type='STORE_ORDER' and resource_id=new.order_id and user_id=new.buyer_user_id;
  else
    update app_private.purchase_review_reminders set state='REVIEWED',updated_at=now()
      where resource_type='TUTORIAL_BOOKING' and resource_id=new.booking_id and user_id=new.student_user_id;
  end if;
  return new;
end;
$$;
drop trigger if exists product_reviews_close_reminder on public.product_reviews;
create trigger product_reviews_close_reminder after insert on public.product_reviews
  for each row execute function app_private.close_purchase_review_reminder();
drop trigger if exists tutorial_reviews_close_reminder on public.tutorial_reviews;
create trigger tutorial_reviews_close_reminder after insert on public.tutorial_reviews
  for each row execute function app_private.close_purchase_review_reminder();

-- Run from the bounded scheduled worker and on foreground/inbox reads. Both
-- paths share row locks and a notification dedupe key; no duplicate prompts.
create or replace function app_private.queue_due_purchase_review_notifications(p_user_id uuid default null)
returns integer language plpgsql set search_path='' as $$
declare reminder record; title text; destination text; queued integer:=0;
begin
  for reminder in select r.* from app_private.purchase_review_reminders r
    join public.users u on u.id=r.user_id and u.status::text='ACTIVE' and u.deleted_at is null
    join public.profiles p on p.user_id=r.user_id and p.university_id=r.university_id and p.deleted_at is null
    where r.state='PENDING' and r.notified_at is null and r.due_at<=now() and r.due_at>now()-interval '30 days'
      and (p_user_id is null or r.user_id=p_user_id)
      and ((r.resource_type='STORE_ORDER' and exists(select 1 from public.orders o
        where o.id=r.resource_id and o.buyer_user_id=r.user_id and o.university_id=r.university_id and o.status='DELIVERED'
          and not exists(select 1 from public.product_reviews v where v.order_id=o.id and v.buyer_user_id=r.user_id)))
        or (r.resource_type='TUTORIAL_BOOKING' and exists(select 1 from public.tutorial_bookings b
        where b.id=r.resource_id and b.student_user_id=r.user_id and b.university_id=r.university_id and b.status='COMPLETED'
          and not exists(select 1 from public.tutorial_reviews v where v.booking_id=b.id and v.student_user_id=r.user_id))))
    order by r.due_at,r.id limit 100 for update of r skip locked
  loop
    title:=case when reminder.resource_type='STORE_ORDER' then 'How was your purchase?' else 'How was your tutorial?' end;
    destination:=case when reminder.resource_type='STORE_ORDER' then '/order-detail?id='||reminder.resource_id::text||'&review=1' else '/purchases' end;
    insert into public.in_app_notifications(user_id,institution_id,title,body,path,dedupe_key)
      values(reminder.user_id,reminder.university_id,title,'You can leave a rating whenever you are ready. Reviewing is optional.',
        destination,'purchase-review:'||reminder.resource_type||':'||reminder.resource_id::text) on conflict(dedupe_key) do nothing;
    update app_private.purchase_review_reminders set notified_at=now(),updated_at=now() where id=reminder.id;
    queued:=queued+1;
  end loop;
  return queued;
end;
$$;
revoke all on app_private.purchase_review_reminders from public;
revoke all on function app_private.schedule_purchase_review_reminder() from public;
revoke all on function app_private.close_purchase_review_reminder() from public;
revoke all on function app_private.queue_due_purchase_review_notifications(uuid) from public;
commit;
