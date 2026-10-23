-- Keep marketplace credentials inaccessible to browser roles.
create table if not exists public.marketplace_connection_secrets (
  connection_id uuid primary key references public.marketplace_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  expires_at timestamptz not null,
  token_type text,
  scope text,
  refresh_lock_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.marketplace_connection_secrets enable row level security;
revoke all on public.marketplace_connection_secrets from public, anon, authenticated;

drop policy if exists "connections own all" on public.marketplace_connections;
drop policy if exists "connections own read" on public.marketplace_connections;
create policy "connections own read" on public.marketplace_connections
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.marketplace_connections from public, anon, authenticated;
grant select (
  id,
  user_id,
  platform,
  external_account_id,
  account_label,
  status,
  expires_at,
  last_synced_at,
  last_error,
  created_at,
  updated_at
) on public.marketplace_connections to authenticated;

create unique index if not exists marketplace_listings_connection_external_unique
  on public.marketplace_listings (
    connection_id,
    platform,
    external_item_id,
    coalesce(external_variant_id, '')
  )
  where connection_id is not null;

create unique index if not exists orders_connection_external_unique
  on public.orders(connection_id, external_order_id)
  where connection_id is not null;

create or replace function public.store_marketplace_connection(
  p_user_id uuid,
  p_platform text,
  p_external_account_id text,
  p_account_label text,
  p_access_token_ciphertext text,
  p_refresh_token_ciphertext text,
  p_expires_at timestamptz,
  p_token_type text,
  p_scope text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_connection_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'A operação exige acesso de servidor.';
  end if;
  if p_user_id is null
     or p_platform not in ('mercado_livre', 'shopee')
     or nullif(trim(p_external_account_id), '') is null
     or nullif(p_access_token_ciphertext, '') is null
     or nullif(p_refresh_token_ciphertext, '') is null
     or p_expires_at is null then
    raise exception 'Dados da conexão incompletos.';
  end if;

  insert into public.marketplace_connections (
    user_id, platform, external_account_id, account_label, status, expires_at, last_error, updated_at
  )
  values (
    p_user_id, p_platform, trim(p_external_account_id), nullif(trim(p_account_label), ''),
    'connected', p_expires_at, null, now()
  )
  on conflict (user_id, platform, external_account_id)
  do update set
    account_label = excluded.account_label,
    status = 'connected',
    expires_at = excluded.expires_at,
    last_error = null,
    updated_at = now()
  returning id into v_connection_id;

  insert into public.marketplace_connection_secrets (
    connection_id, user_id, access_token_ciphertext, refresh_token_ciphertext,
    expires_at, token_type, scope, refresh_lock_until, updated_at
  )
  values (
    v_connection_id, p_user_id, p_access_token_ciphertext, p_refresh_token_ciphertext,
    p_expires_at, p_token_type, p_scope, null, now()
  )
  on conflict (connection_id)
  do update set
    user_id = excluded.user_id,
    access_token_ciphertext = excluded.access_token_ciphertext,
    refresh_token_ciphertext = excluded.refresh_token_ciphertext,
    expires_at = excluded.expires_at,
    token_type = excluded.token_type,
    scope = excluded.scope,
    refresh_lock_until = null,
    updated_at = now();

  return v_connection_id;
end;
$$;

create or replace function public.disconnect_marketplace_connection(
  p_user_id uuid,
  p_connection_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'A operação exige acesso de servidor.';
  end if;

  delete from public.marketplace_connection_secrets
   where connection_id = p_connection_id and user_id = p_user_id;

  update public.marketplace_connections
     set status = 'disconnected', expires_at = null, last_error = null, updated_at = now()
   where id = p_connection_id and user_id = p_user_id;

  return found;
end;
$$;

revoke all on function public.store_marketplace_connection(uuid, text, text, text, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.store_marketplace_connection(uuid, text, text, text, text, text, timestamptz, text, text) to service_role;

revoke all on function public.disconnect_marketplace_connection(uuid, uuid) from public, anon, authenticated;
grant execute on function public.disconnect_marketplace_connection(uuid, uuid) to service_role;
