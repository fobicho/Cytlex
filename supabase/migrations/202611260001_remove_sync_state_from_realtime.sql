do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
      and puballtables
  ) then
    raise exception 'supabase_realtime publishes all tables; cytlex_sync_state cannot be excluded individually';
  end if;

  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cytlex_sync_state'
  ) then
    alter publication supabase_realtime drop table public.cytlex_sync_state;
  end if;
end;
$$;
