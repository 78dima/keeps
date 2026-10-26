-- Fixtures and timestamp audit run only inside the test transaction, then roll back.
insert into auth.users(id,email) values('81219b1c-cd19-490a-ab00-000000000003','migration-test@example.invalid');
insert into public.notes(id,user_id,title,updated_at) values('a1219b1c-cd19-490a-ab00-000000000003','81219b1c-cd19-490a-ab00-000000000003','migration fixture','2026-01-01T09:00:00Z');
insert into public.tags(id,user_id,name,updated_at) values('a1219b1c-cd19-490a-ab00-000000000003','81219b1c-cd19-490a-ab00-000000000003','migration fixture','2026-01-01T09:00:00Z');
create temp table migration_clock_audit as select 'notes' as entity,id,updated_at from public.notes union all select 'tags',id,updated_at from public.tags;
