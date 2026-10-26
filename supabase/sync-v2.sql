-- MonoKeep sync v2. Apply transactionally after the initial schema.
-- updated_at is EDIT time. sync_revision is SERVER arrival order. Never interchange them.
create schema if not exists monokeep_private;
revoke all on schema monokeep_private from public, anon, authenticated;
create sequence if not exists public.monokeep_sync_revision;
grant usage on sequence public.monokeep_sync_revision to authenticated, service_role;

alter table public.notes add column if not exists edit_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table public.notes add column if not exists sync_revision bigint not null default 0;
alter table public.tags add column if not exists edit_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table public.tags add column if not exists sync_revision bigint not null default 0;
-- Existing data stays intact and participates in the first full pull.
update public.notes set sync_revision = nextval('public.monokeep_sync_revision') where sync_revision = 0;
update public.tags set sync_revision = nextval('public.monokeep_sync_revision') where sync_revision = 0;
create index if not exists notes_sync_cursor on public.notes(user_id, sync_revision);
create index if not exists tags_sync_cursor on public.tags(user_id, sync_revision);

drop trigger if exists update_notes_updated_at on public.notes;
drop trigger if exists update_tags_updated_at on public.tags;

create table if not exists public.note_conflicts (
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid not null,
  edit_id uuid not null,
  edited_at timestamptz not null,
  snapshot jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (user_id, note_id, edited_at, edit_id)
);
alter table public.note_conflicts enable row level security;
create policy own_conflicts on public.note_conflicts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, delete on public.note_conflicts to authenticated;
grant all on public.note_conflicts to service_role;

-- One transaction lock per owner makes revisions commit-ordered for that owner's feed.
-- A bare sequence would skip a transaction that allocated an ID but committed late.
create or replace function monokeep_private.version_write() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare metadata_only boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 712041));
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id then raise exception 'Cannot change note owner'; end if;
    if tg_table_name = 'notes' then
      metadata_only := (to_jsonb(new) - array['is_reminder_sent','was_sent_once','sync_revision'])
        = (to_jsonb(old) - array['is_reminder_sent','was_sent_once','sync_revision']);
    end if;
    if not metadata_only and (new.updated_at, new.edit_id) <= (old.updated_at, old.edit_id) then
      return null; -- Also protects writes from older web clients using plain upsert.
    end if;
    if to_jsonb(new) - 'sync_revision' = to_jsonb(old) - 'sync_revision' then return null; end if;
    if tg_table_name = 'notes' and not metadata_only then
      if new.reminder_date is distinct from old.reminder_date then new.is_reminder_sent := false;
      else new.is_reminder_sent := old.is_reminder_sent; end if;
    end if;
  end if;
  if new.updated_at is null or new.updated_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'Invalid edit time; check device clock';
  end if;
  new.sync_revision := nextval('public.monokeep_sync_revision');
  return new;
end $$;
create trigger monokeep_version_notes before insert or update on public.notes
  for each row execute function monokeep_private.version_write();
create trigger monokeep_version_tags before insert or update on public.tags
  for each row execute function monokeep_private.version_write();
-- Deletion is a versioned tombstone. A physical DELETE cannot be replayed to offline devices.
revoke delete on public.notes, public.tags from anon, authenticated;

create or replace function public.sync_clock() returns timestamptz
language sql security invoker set search_path = '' as $$ select clock_timestamp() $$;
revoke all on function public.sync_clock() from public;
grant execute on function public.sync_clock() to authenticated;

create or replace function public.sync_pull(entity text, after_revision bigint default 0, page_size integer default 100)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare rows jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if entity not in ('notes', 'tags') then raise exception 'Unknown entity'; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(''sync_revision'', r.sync_revision::text) order by r.sync_revision), ''[]''::jsonb) from (select * from public.%I where user_id = $1 and sync_revision > $2 order by sync_revision limit $3) r', entity)
    into rows using auth.uid(), greatest(after_revision, 0), least(greatest(page_size, 1), 200);
  return jsonb_build_object('rows', rows, 'server_time', clock_timestamp());
end $$;
revoke all on function public.sync_pull(text,bigint,integer) from public;
grant execute on function public.sync_pull(text,bigint,integer) to authenticated;

create or replace function public.sync_push(entity text, documents jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare doc jsonb; current_row jsonb; result_rows jsonb := '[]'; owner uuid := auth.uid();
        note public.notes; tag public.tags;
begin
  if owner is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if entity not in ('notes','tags') or jsonb_typeof(documents) <> 'array' or jsonb_array_length(documents) > 100 then
    raise exception 'Invalid sync batch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text, 712041));
  for doc in select value from jsonb_array_elements(documents) loop
    if doc->>'user_id' is distinct from owner::text then raise exception 'Wrong owner' using errcode='42501'; end if;
    if entity = 'notes' then
      note := jsonb_populate_record(null::public.notes, doc);
      if note.id is null or note.updated_at is null then raise exception 'Missing identity or edit time'; end if;
      note.edit_id := coalesce(note.edit_id, '00000000-0000-0000-0000-000000000000'::uuid);
      select to_jsonb(n) into current_row from public.notes n where id=note.id and user_id=owner for update;
      -- Preserve both sides of competing edits for recovery, without changing their edit time.
      if current_row is not null and (current_row->>'edit_id',current_row->>'updated_at') is distinct from (doc->>'edit_id',doc->>'updated_at') then
        insert into public.note_conflicts(user_id,note_id,edit_id,edited_at,snapshot)
          values(owner,note.id,(current_row->>'edit_id')::uuid,(current_row->>'updated_at')::timestamptz,current_row)
          on conflict do nothing;
        if (note.updated_at,note.edit_id) < ((current_row->>'updated_at')::timestamptz,(current_row->>'edit_id')::uuid) then
          insert into public.note_conflicts(user_id,note_id,edit_id,edited_at,snapshot)
            values(owner,note.id,note.edit_id,note.updated_at,doc) on conflict do nothing;
        end if;
      end if;
      insert into public.notes(id,user_id,title,content,color,is_pinned,is_archived,is_deleted,sync_deleted,
        reminder_date,is_reminder_sent,tags,created_at,updated_at,edit_id)
      values(note.id,owner,coalesce(note.title,''),coalesce(note.content,''),note.color,
        coalesce(note.is_pinned,false),coalesce(note.is_archived,false),coalesce(note.is_deleted,false),coalesce(note.sync_deleted,false),
        note.reminder_date,false,coalesce(note.tags,'[]'),coalesce(note.created_at,note.updated_at),note.updated_at,note.edit_id)
      on conflict(id) do update set title=excluded.title,content=excluded.content,color=excluded.color,
        is_pinned=excluded.is_pinned,is_archived=excluded.is_archived,is_deleted=excluded.is_deleted,
        sync_deleted=excluded.sync_deleted,reminder_date=excluded.reminder_date,tags=excluded.tags,
        updated_at=excluded.updated_at,edit_id=excluded.edit_id;
      select to_jsonb(n) || jsonb_build_object('sync_revision',n.sync_revision::text) into current_row
        from public.notes n where id=note.id and user_id=owner;
    else
      tag := jsonb_populate_record(null::public.tags, doc);
      insert into public.tags(id,user_id,name,sync_deleted,updated_at,edit_id)
        values(tag.id,owner,tag.name,coalesce(tag.sync_deleted,false),tag.updated_at,coalesce(tag.edit_id,'00000000-0000-0000-0000-000000000000'::uuid))
        on conflict(id) do update set name=excluded.name,sync_deleted=excluded.sync_deleted,updated_at=excluded.updated_at,edit_id=excluded.edit_id;
      select to_jsonb(t) || jsonb_build_object('sync_revision',t.sync_revision::text) into current_row
        from public.tags t where id=tag.id and user_id=owner;
    end if;
    if current_row is null then raise exception 'Note is not accessible' using errcode='42501'; end if;
    result_rows := result_rows || jsonb_build_array(current_row);
  end loop;
  return jsonb_build_object('rows', result_rows, 'server_time',clock_timestamp());
end $$;
revoke all on function public.sync_push(text,jsonb) from public;
grant execute on function public.sync_push(text,jsonb) to authenticated;

create table public.sync_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  fcm_token text not null,
  updated_at timestamptz not null default now(),
  primary key(user_id,device_id)
);
alter table public.sync_devices enable row level security;
create policy own_sync_devices on public.sync_devices for all to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select,insert,update,delete on public.sync_devices to authenticated;
grant all on public.sync_devices to service_role;

-- Durable, coalesced notification queue. The sender acknowledges the revision it sent;
-- an edit arriving during delivery must stay queued.
create table public.sync_signals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null,
  updated_at timestamptz not null default now()
);
alter table public.sync_signals enable row level security;
create policy own_sync_signal on public.sync_signals for all to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select,insert,update on public.sync_signals to authenticated;
grant all on public.sync_signals to service_role;
create or replace function monokeep_private.queue_signal() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  insert into public.sync_signals(user_id,revision) values(new.user_id,new.sync_revision)
    on conflict(user_id) do update set revision=greatest(public.sync_signals.revision,excluded.revision),updated_at=clock_timestamp();
  return new;
end $$;
create trigger monokeep_signal_notes after insert or update on public.notes
  for each row execute function monokeep_private.queue_signal();
create trigger monokeep_signal_tags after insert or update on public.tags
  for each row execute function monokeep_private.queue_signal();
