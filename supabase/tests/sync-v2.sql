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
  execute 'set local role service_role';
  update public.notes set is_reminder_sent = true where notes.id = note_key;
  execute 'set local role authenticated';
  select sync_revision into rev from public.notes where notes.id=note_key;
  if rev <= before_rev then raise exception 'Delivery did not reach feed'; end if;
  if (select updated_at from public.notes where notes.id=note_key) <> '2026-01-01T10:10:00Z'::timestamptz then raise exception 'Delivery changed edit time'; end if;
  perform public.sync_push('notes',jsonb_build_array(base || '{"sync_deleted":true,"is_deleted":true,"updated_at":"2026-01-01T10:11:00Z","edit_id":"00000000-0000-0000-0000-000000000005"}'::jsonb));
  answer := public.sync_push('notes',jsonb_build_array(base));
  if not (answer->'rows'->0->>'sync_deleted')::boolean then raise exception 'Stale edit resurrected deletion'; end if;
  -- Old plain-upsert clients must obey the same timestamp guard.
  update public.notes set title='stale legacy', updated_at='2026-01-01T10:01:00Z', edit_id='00000000-0000-0000-0000-000000000001' where notes.id=note_key;
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


set local role authenticated;
select set_config('request.jwt.claim.sub','81219b1c-cd19-490a-ab00-000000000001',true);
do $$
declare doc jsonb; answer jsonb; note_key uuid := '91219b1c-cd19-490a-ab00-000000000007';
begin
  doc := jsonb_build_object('id',note_key,'user_id',auth.uid(),'title','Original','content','test',
    'updated_at','2026-01-01T10:00:00Z','sort_at','2026-01-01T09:00:00Z',
    'edit_id','00000000-0000-0000-0000-000000000001','reminder_date','2026-01-01T09:30:00Z',
    'reminder_enabled',true,'reminder_version','00000000-0000-0000-0000-000000000010');
  perform public.sync_push('notes',jsonb_build_array(doc));
  -- Exact production v12 delivery UPDATE: must not alter edit time or undo delivery.
  execute 'set local role service_role';
  update public.notes set is_reminder_sent=true,was_sent_once=true,updated_at=clock_timestamp() where id=note_key;
  update public.notes set is_reminder_sent=true,was_sent_once=true,updated_at=clock_timestamp() where id=note_key;
  execute 'set local role authenticated';
  if not (select is_reminder_sent from public.notes where id=note_key) then raise exception 'Production sender ACK lost'; end if;
  if (select updated_at from public.notes where id=note_key) <> '2026-01-01T10:00:00Z'::timestamptz then raise exception 'Delivery became an edit'; end if;
  if (select sort_at from public.notes where id=note_key) <= '2026-01-01T09:00:00Z'::timestamptz then raise exception 'Delivery did not raise display order'; end if;
  doc := doc || '{"title":"Later offline text","updated_at":"2026-01-01T10:05:00Z","edit_id":"00000000-0000-0000-0000-000000000002"}'::jsonb;
  answer := public.sync_push('notes',jsonb_build_array(doc));
  if answer->'rows'->0->>'title' <> 'Later offline text' then raise exception 'Delivery defeated newer offline edit'; end if;
  if not (answer->'rows'->0->>'is_reminder_sent')::boolean then raise exception 'Content edit rearmed delivery'; end if;
  doc := doc || '{"updated_at":"2026-01-01T10:06:00Z","edit_id":"00000000-0000-0000-0000-000000000003","reminder_version":"00000000-0000-0000-0000-000000000011"}'::jsonb;
  answer := public.sync_push('notes',jsonb_build_array(doc));
  if (answer->'rows'->0->>'is_reminder_sent')::boolean then raise exception 'Bell did not rearm same date'; end if;
  execute 'set local role service_role';
  update public.notes set is_reminder_sent=true,was_sent_once=true where id=note_key and reminder_version='00000000-0000-0000-0000-000000000010';
  execute 'set local role authenticated';
  if (select is_reminder_sent from public.notes where id=note_key) then raise exception 'Old delivery ACK suppressed a new reminder'; end if;
  doc := doc || '{"updated_at":"2026-01-01T10:07:00Z","edit_id":"00000000-0000-0000-0000-000000000004","reminder_enabled":false,"reminder_version":"00000000-0000-0000-0000-000000000012"}'::jsonb;
  answer := public.sync_push('notes',jsonb_build_array(doc));
  if (answer->'rows'->0->>'reminder_enabled')::boolean or not (answer->'rows'->0->>'is_reminder_sent')::boolean then raise exception 'Bell did not suppress server delivery'; end if;
  begin
    update public.notes set title='Old browser edit',edit_id='00000000-0000-0000-0000-000000000000' where id=note_key;
    raise exception 'Old client was silently acknowledged';
  exception when raise_exception then
    if SQLERRM not like 'This client must be updated%' then raise; end if;
  end;
end $$;
reset role;
select 'production compatibility: sort order, delivery ACK, offline edit, bell and legacy rejection passed' as result;

set local role authenticated;
select set_config('request.jwt.claim.sub','81219b1c-cd19-490a-ab00-000000000001',true);
do $$
declare legacy jsonb; answer jsonb; legacy_id uuid := '91219b1c-cd19-490a-ab00-000000000008';
begin
  legacy := jsonb_build_object('id',legacy_id,'user_id',auth.uid(),'title','Canonical legacy',
    'content','same','updated_at','2026-01-01T10:00:00Z','edit_id','00000000-0000-0000-0000-000000000000');
  perform public.sync_push('notes',jsonb_build_array(legacy));
  answer := public.sync_push('notes',jsonb_build_array(legacy || '{"title":"Unsent v5 draft","updated_at":"2026-01-01T10:05:00Z"}'::jsonb,
    legacy || '{"id":"91219b1c-cd19-490a-ab00-000000000009","title":"Valid new note","edit_id":"00000000-0000-0000-0000-000000000001"}'::jsonb));
  if answer->'rows'->0->>'title' <> 'Canonical legacy' or answer->'rows'->1->>'title' <> 'Valid new note' then raise exception 'Legacy note blocked the batch'; end if;
  if not exists(select 1 from public.note_conflicts where note_id=legacy_id and snapshot->>'title'='Unsent v5 draft') then raise exception 'Legacy draft was not retained'; end if;
end $$;
reset role;
select 'legacy RPC recovery does not block valid edits' as result;
