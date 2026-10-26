-- Run after sync-v2.sql in a transaction that is ROLLED BACK. No real notes are read.
insert into auth.users(id,email) values('81219b1c-cd19-490a-ab00-000000000001','sync-test-1@example.invalid'),('81219b1c-cd19-490a-ab00-000000000002','sync-test-2@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub','81219b1c-cd19-490a-ab00-000000000001',true);
do $$
declare owner text := auth.uid()::text; note_key uuid := '91219b1c-cd19-490a-ab00-000000000001';
  base jsonb; answer jsonb; rev bigint; before_rev bigint; cursor_rev bigint := 0; received integer := 0; item jsonb;
begin
  base := jsonb_build_object('id',note_key,'user_id',owner,'title','Phone offline 10:00','content','test',
    'updated_at','2026-01-01T10:00:00Z','created_at','2026-01-01T09:00:00Z','edit_id','00000000-0000-0000-0000-000000000001');
  perform public.sync_push('notes', jsonb_build_array(base));
  perform public.sync_push('notes',jsonb_build_array(base || '{"title":"Web 10:05","updated_at":"2026-01-01T10:05:00Z","edit_id":"00000000-0000-0000-0000-000000000002"}'::jsonb));
  answer := public.sync_push('notes',jsonb_build_array(base));
  if answer->'rows'->0->>'title' <> 'Web 10:05' then raise exception 'Offline older write overwrote newer edit'; end if;
  before_rev := (answer->'rows'->0->>'sync_revision')::bigint;
  answer := public.sync_push('notes',jsonb_build_array(base));
  if (answer->'rows'->0->>'sync_revision')::bigint <> before_rev then raise exception 'Retry was not idempotent'; end if;
  perform public.sync_push('notes',jsonb_build_array(base || '{"title":"Phone 10:10","updated_at":"2026-01-01T10:10:00Z","edit_id":"00000000-0000-0000-0000-000000000003"}'::jsonb));
  -- Equal timestamps are deterministic in either arrival order.
  answer := public.sync_push('notes',jsonb_build_array(base || '{"title":"Equal time, higher UUID","updated_at":"2026-01-01T10:10:00Z","edit_id":"00000000-0000-0000-0000-000000000004"}'::jsonb));
  answer := public.sync_push('notes',jsonb_build_array(base || '{"title":"Equal time, lower UUID","updated_at":"2026-01-01T10:10:00Z","edit_id":"00000000-0000-0000-0000-000000000003"}'::jsonb));
  if answer->'rows'->0->>'title' <> 'Equal time, higher UUID' then raise exception 'Tie breaker failed'; end if;
  before_rev := (answer->'rows'->0->>'sync_revision')::bigint;
  update public.notes set is_reminder_sent = true where notes.id = note_key;
  select sync_revision into rev from public.notes where notes.id=note_key;
  if rev <= before_rev then raise exception 'Delivery did not reach feed'; end if;
  if (select updated_at from public.notes where notes.id=note_key) <> '2026-01-01T10:10:00Z'::timestamptz then raise exception 'Delivery changed edit time'; end if;
  perform public.sync_push('notes',jsonb_build_array(base || '{"sync_deleted":true,"is_deleted":true,"updated_at":"2026-01-01T10:11:00Z","edit_id":"00000000-0000-0000-0000-000000000005"}'::jsonb));
  answer := public.sync_push('notes',jsonb_build_array(base));
  if not (answer->'rows'->0->>'sync_deleted')::boolean then raise exception 'Stale edit resurrected deletion'; end if;
  -- Old plain-upsert clients must obey the same timestamp guard.
  update public.notes set title='stale legacy', updated_at='2026-01-01T10:01:00Z' where notes.id=note_key;
  if (select title from public.notes where notes.id=note_key)='stale legacy' then raise exception 'Legacy client bypassed ordering'; end if;
  for n in 2..6 loop
    perform public.sync_push('notes',jsonb_build_array(base || jsonb_build_object('id',('91219b1c-cd19-490a-ab00-'||lpad(n::text,12,'0'))::uuid)));
  end loop;
  loop
    answer := public.sync_pull('notes',cursor_rev,2);
    exit when jsonb_array_length(answer->'rows')=0;
    for item in select value from jsonb_array_elements(answer->'rows') loop
      if (item->>'sync_revision')::bigint <= cursor_rev then raise exception 'Cursor did not advance'; end if;
      cursor_rev := (item->>'sync_revision')::bigint; received := received+1;
    end loop;
  end loop;
  if received <> 6 then raise exception 'Pagination lost rows: %', received; end if;
  begin
    perform public.sync_push('notes',jsonb_build_array(base || '{"user_id":"81219b1c-cd19-490a-ab00-000000000002"}'::jsonb));
    raise exception 'Wrong-owner push accepted';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.notes where notes.id=note_key;
    raise exception 'Physical deletion allowed';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','81219b1c-cd19-490a-ab00-000000000002',true);
do $$ begin
  if jsonb_array_length(public.sync_pull('notes',0,100)->'rows')<>0 then raise exception 'Another account leaked'; end if;
end $$;
reset role;
select 'sync-v2: ordering, retry, ties, delivery, tombstones, pagination, legacy guard, RLS passed' as result;
