begin;
create or replace function app_private.record_direct_thread_activity() returns trigger language plpgsql set search_path=pg_catalog,public,app_private as $$
declare m public.direct_messages; actor uuid; action text; preview text; reaction_value text;
begin
 if TG_TABLE_NAME='direct_message_reactions' then
  if TG_OP='UPDATE' and NEW.reaction is not distinct from OLD.reaction then return NEW; end if;
  if TG_OP='DELETE' then select * into m from public.direct_messages where id=OLD.message_id;actor=OLD.user_id;preview='Removed a reaction';else select * into m from public.direct_messages where id=NEW.message_id;actor=NEW.user_id;reaction_value=NEW.reaction;preview='Reacted '||reaction_value;end if;action='REACTION';
 else
  if TG_OP='DELETE' then select * into m from public.direct_messages where id=OLD.message_id;actor=OLD.pinned_by;action='UNPIN';preview='Unpinned a message';else select * into m from public.direct_messages where id=NEW.message_id;actor=NEW.pinned_by;action='PIN';preview='Pinned a message';end if;
 end if;
 if m.id is not null and m.unsent_at is null then
  insert into app_private.direct_thread_activity(thread_id,actor_user_id,message_id,kind,summary) values(m.thread_id,actor,m.id,action,preview);
  update public.direct_threads set updated_at=now() where id=m.thread_id;
 end if;
 if TG_OP='DELETE' then return OLD;end if;return NEW;
end $$;
create or replace trigger direct_reaction_activity after insert or update or delete on public.direct_message_reactions for each row execute function app_private.record_direct_thread_activity();
create or replace trigger direct_pin_activity after insert or delete on public.direct_message_pins for each row execute function app_private.record_direct_thread_activity();
commit;
