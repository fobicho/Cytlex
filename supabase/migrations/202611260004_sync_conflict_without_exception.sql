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
  return coalesce(next_revision, 0);
end;
$$;
