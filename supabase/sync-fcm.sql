-- Apply after sync-v2.sql. Store the two values with vault.create_secret(), not in source control:
-- monokeep_sync_dispatch_secret: random 32+ byte value
-- monokeep_firebase_service_account: Firebase service account JSON (FCM sender role only)
-- SECURITY DEFINER is confined to a private schema; the public API is service-role only.
create or replace function monokeep_private.dispatch_config() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_object_agg(case name when 'monokeep_sync_dispatch_secret' then 'dispatch_secret'
    else 'firebase_service_account' end, decrypted_secret)
  from vault.decrypted_secrets where name in ('monokeep_sync_dispatch_secret','monokeep_firebase_service_account')
$$;
revoke all on function monokeep_private.dispatch_config() from public,anon,authenticated;
grant usage on schema monokeep_private to service_role;
grant execute on function monokeep_private.dispatch_config() to service_role;
create or replace function public.sync_dispatch_config() returns jsonb
language sql security invoker set search_path = '' as $$ select monokeep_private.dispatch_config() $$;
revoke all on function public.sync_dispatch_config() from public,anon,authenticated;
grant execute on function public.sync_dispatch_config() to service_role;

-- A persistent queue plus a one-minute cron covers changes from all writers, including old web tabs.
-- Never embed an API credential in cron.command or an APK.
create or replace function monokeep_private.dispatch_sync_signals() returns void
language plpgsql security definer set search_path = '' as $$
declare secret text;
begin
  if not exists(select 1 from public.sync_signals) then return; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name='monokeep_sync_dispatch_secret' limit 1;
  if secret is null then return; end if;
  perform net.http_post(url := 'https://lhjbeaaglpimzkfgrqdp.supabase.co/functions/v1/sync-dispatch',
    headers := jsonb_build_object('Content-Type','application/json','X-Sync-Secret',secret),body := '{}'::jsonb);
end $$;
revoke all on function monokeep_private.dispatch_sync_signals() from public,anon,authenticated;
select cron.schedule('monokeep-sync-fcm','* * * * *','select monokeep_private.dispatch_sync_signals()');
