begin;
create index if not exists communities_scope_idx on public.cohort_communities(institution_id, admission_year desc);
create index if not exists elections_due_idx on public.community_elections(ends_at) where status='SCHEDULED';
create unique index if not exists rep_transfer_pending_idx on public.community_rep_transfers(community_id) where status in ('PENDING','ACCEPTED');

-- All voting writers lock the election row. A ballot cannot race finalization.
create or replace function app_private.community_participate(target_election uuid, actor uuid, candidate uuid default null)
returns text language plpgsql set search_path='' as $$
declare e public.community_elections; membership public.community_members; begin
  select * into e from public.community_elections where id=target_election for update;
  if e.id is null then raise exception 'COMMUNITY_NOT_FOUND'; end if;
  if e.status<>'SCHEDULED' or now()<e.starts_at or now()>=e.ends_at then raise exception 'ELECTION_NOT_OPEN'; end if;
  select m.* into membership from public.community_members m
    join public.cohort_communities c on c.id=m.community_id
    join public.profiles p on p.user_id=m.user_id
    where m.community_id=e.community_id and m.user_id=actor and m.verified_at is not null
      and c.archived_at is null and p.university_id=c.institution_id and p.department_id=c.department_id and p.deleted_at is null;
  if membership.user_id is null then raise exception 'VERIFIED_MEMBERSHIP_REQUIRED'; end if;
  if exists(select 1 from public.account_restrictions where user_id=actor and revoked_at is null and starts_at<=now() and (ends_at is null or ends_at>now())) then raise exception 'MEMBER_RESTRICTED'; end if;
  if candidate is null then
    insert into public.community_candidates(election_id,user_id) values(e.id,actor) on conflict do nothing;
    return 'candidate_registered';
  end if;
  if not exists(select 1 from public.community_candidates c join public.community_members m on m.community_id=e.community_id and m.user_id=c.user_id where c.election_id=e.id and c.user_id=candidate and m.verified_at is not null) then raise exception 'CANDIDATE_NOT_FOUND'; end if;
  insert into app_private.community_votes(election_id,voter_id,candidate_id) values(e.id,actor,candidate) on conflict do nothing;
  if not found then return 'already_voted'; end if;
  return 'vote_recorded';
end $$;

create or replace function app_private.finalize_community_election(target_election uuid)
returns text language plpgsql set search_path='' as $$
declare e public.community_elections; winners uuid[]; best_votes bigint; begin
  select * into e from public.community_elections where id=target_election for update;
  if e.id is null then raise exception 'COMMUNITY_NOT_FOUND'; end if;
  if e.status<>'SCHEDULED' then return e.status; end if;
  if now()<e.ends_at then raise exception 'ELECTION_NOT_DUE'; end if;
  with eligible as (
    select c.user_id,count(v.voter_id) votes from public.community_candidates c
    join public.community_members m on m.community_id=e.community_id and m.user_id=c.user_id and m.verified_at is not null
    join public.cohort_communities cc on cc.id=m.community_id and cc.archived_at is null
    join public.profiles p on p.user_id=c.user_id and p.university_id=cc.institution_id and p.department_id=cc.department_id and p.deleted_at is null
    join public.users u on u.id=c.user_id and u.status::text='ACTIVE' and u.deleted_at is null
    left join app_private.community_votes v on v.election_id=c.election_id and v.candidate_id=c.user_id
    where c.election_id=e.id and not exists(select 1 from public.account_restrictions r where r.user_id=c.user_id and r.revoked_at is null and r.starts_at<=now() and (r.ends_at is null or r.ends_at>now()))
    group by c.user_id
  ), top as(select * from eligible where votes=(select max(votes) from eligible))
  select array_agg(user_id),max(votes) into winners,best_votes from top;
  if coalesce(best_votes,0)=0 then
    update public.community_elections set status='CLOSED' where id=e.id; return 'NO_VOTES';
  end if;
  if cardinality(winners)>1 then
    update public.community_elections set status='TIED' where id=e.id; return 'TIED';
  end if;
  update public.community_elections set status='CLOSED',winner_user_id=winners[1] where id=e.id;
  update public.cohort_communities set rep_user_id=winners[1] where id=e.community_id and archived_at is null;
  insert into public.in_app_notifications(user_id,institution_id,title,body,path,dedupe_key)
    select winners[1],institution_id,'You are the course rep',name,'/community?id='||id,'election-winner:'||e.id from public.cohort_communities where id=e.community_id on conflict do nothing;
  return 'ELECTED';
end $$;

create or replace function app_private.publish_community_announcement(target_community uuid, actor uuid, heading text, message text, request_id uuid)
returns uuid language plpgsql set search_path='' as $$
declare cc public.cohort_communities; begin
  select * into cc from public.cohort_communities where id=target_community for update;
  if cc.id is null or cc.archived_at is not null or cc.rep_user_id is distinct from actor then raise exception 'COURSE_REP_REQUIRED'; end if;
  if char_length(heading) not between 3 and 140 or char_length(message) not between 3 and 4000 then raise exception 'INVALID_ANNOUNCEMENT'; end if;
  if exists(select 1 from public.community_announcements where id=request_id and community_id=cc.id and author_id=actor and title=heading and body=message) then return request_id; end if;
  if (select count(*) from public.community_announcements where community_id=cc.id and created_at>now()-interval '1 hour')>=10 then raise exception 'ANNOUNCEMENT_LIMIT'; end if;
  insert into public.community_announcements(id,community_id,author_id,title,body) values(request_id,cc.id,actor,heading,message);
  insert into public.in_app_notifications(user_id,institution_id,title,body,path,dedupe_key)
    select m.user_id,cc.institution_id,heading,message,'/community?id='||cc.id,'announcement:'||request_id||':'||m.user_id from public.community_members m where m.community_id=cc.id;
  insert into app_private.notification_outbox(user_id,channel,subject,body,dedupe_key)
    select m.user_id,'PUSH',heading,message,'announcement-push:'||request_id||':'||m.user_id from public.community_members m where m.community_id=cc.id;
  return request_id;
end $$;
revoke all on function app_private.community_participate(uuid,uuid,uuid),app_private.finalize_community_election(uuid),app_private.publish_community_announcement(uuid,uuid,text,text,uuid) from public;
commit;
