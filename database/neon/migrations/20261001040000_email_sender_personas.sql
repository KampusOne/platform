begin;

-- KampusOne owns transactional mail. George is the managed editorial voice for
-- product updates, promotions and community communications.
insert into app_private.email_personas (id, display_name, active)
values ('00000000-0000-4000-8000-000000000053', 'George from KampusOne', true)
on conflict (id) do update
set display_name = excluded.display_name,
    active = true;

commit;
