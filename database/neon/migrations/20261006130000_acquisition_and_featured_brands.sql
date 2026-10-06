begin;
create table app_private.user_acquisition(
 user_id uuid not null references public.users(id) on delete cascade,
 institution_id uuid not null references public.universities(id),
 context text not null check(context in('STUDENT','VENDOR','TUTOR','RIDER')),
 source text not null check(source in('FACEBOOK','TIKTOK','WHATSAPP','INSTAGRAM','FRIENDS','OTHER')),
 other_text text not null default '' check(length(other_text)<=240),created_at timestamptz not null default now(),
 primary key(user_id,context),check(source='OTHER' or other_text='')
);
create index user_acquisition_campus_idx on app_private.user_acquisition(institution_id,source,context,created_at desc);
alter table app_private.user_acquisition enable row level security;
revoke all on app_private.user_acquisition from public;
create table app_private.featured_brands(
 institution_id uuid not null references public.universities(id),
 agent_profile_id uuid not null references public.agent_profiles(id) on delete cascade,
 position integer not null default 0 check(position between 0 and 1000),
 enabled boolean not null default true,
 created_by uuid not null references public.users(id),created_at timestamptz not null default now(),
 primary key(institution_id,agent_profile_id)
);
alter table app_private.featured_brands enable row level security;
revoke all on app_private.featured_brands from public;
create function app_private.submit_trusted_vendor_with_acquisition(p_user uuid,p_hash text,p_request uuid,p_values jsonb,p_acquisition jsonb)
returns uuid language plpgsql set search_path='' as $$
declare application uuid;campus uuid;
begin
 application=app_private.submit_trusted_vendor(p_user,p_hash,p_request,p_values);
 if p_acquisition is not null and p_acquisition<>'null'::jsonb then
  select university_id into campus from public.agent_applications where id=application and user_id=p_user;
  insert into app_private.user_acquisition(user_id,institution_id,context,source,other_text)
  values(p_user,campus,'VENDOR',p_acquisition->>'source',case when p_acquisition->>'source'='OTHER'then p_acquisition->>'other'else ''end)
  on conflict(user_id,context)do nothing;
 end if;
 return application;
end $$;
revoke all on function app_private.submit_trusted_vendor_with_acquisition(uuid,text,uuid,jsonb,jsonb) from public;
commit;
