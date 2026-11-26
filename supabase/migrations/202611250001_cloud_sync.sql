create table if not exists public.cytlex_sync_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint cytlex_sync_payload_object check (jsonb_typeof(payload) = 'object')
);

alter table public.cytlex_sync_state enable row level security;

revoke all on table public.cytlex_sync_state from anon, authenticated;
grant select, insert, update on table public.cytlex_sync_state to authenticated;

drop policy if exists "Users can read their own Cytlex sync state" on public.cytlex_sync_state;
create policy "Users can read their own Cytlex sync state"
  on public.cytlex_sync_state for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own Cytlex sync state" on public.cytlex_sync_state;
create policy "Users can insert their own Cytlex sync state"
  on public.cytlex_sync_state for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own Cytlex sync state" on public.cytlex_sync_state;
create policy "Users can update their own Cytlex sync state"
  on public.cytlex_sync_state for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.save_cytlex_sync_state(p_payload jsonb, p_expected_revision bigint)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_revision bigint;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload must be a JSON object' using errcode = '22023';
  end if;

  if p_expected_revision = 0 then
    insert into public.cytlex_sync_state (user_id, payload, revision, updated_at)
    values (current_user_id, p_payload, 1, now())
    on conflict (user_id) do nothing
    returning revision into next_revision;
  else
    update public.cytlex_sync_state
    set payload = p_payload, revision = revision + 1, updated_at = now()
    where user_id = current_user_id and revision = p_expected_revision
    returning revision into next_revision;
  end if;

  if next_revision is null then
    raise exception 'Sync revision conflict' using errcode = '40001';
  end if;
  return next_revision;
end;
$$;

revoke all on function public.save_cytlex_sync_state(jsonb, bigint) from public, anon;
grant execute on function public.save_cytlex_sync_state(jsonb, bigint) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'cytlex_sync_state'
    ) then
    execute 'alter publication supabase_realtime add table public.cytlex_sync_state';
  end if;
end;
$$;
