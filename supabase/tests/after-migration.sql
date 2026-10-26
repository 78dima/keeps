do $$ begin
  if exists(select 1 from migration_clock_audit a join public.notes n on a.entity='notes' and n.id=a.id where a.updated_at is distinct from n.updated_at)
    or exists(select 1 from migration_clock_audit a join public.tags t on a.entity='tags' and t.id=a.id where a.updated_at is distinct from t.updated_at)
  then raise exception 'Migration changed original edit times'; end if;
end $$;
