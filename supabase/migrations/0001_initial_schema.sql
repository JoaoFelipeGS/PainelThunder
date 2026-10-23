-- Central de Vendas: schema inicial.
-- Execute em Supabase SQL Editor. Revise as políticas antes de abrir o acesso a outras contas.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  created_at timestamptz not null default now()
);

create table if not exists public.marketplace_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('mercado_livre','shopee')),
  external_account_id text,
  account_label text,
  status text not null default 'pending' check (status in ('pending','connected','expired','error','disconnected')),
  token_ciphertext text,
  refresh_token_ciphertext text,
  expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform, external_account_id)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sku text,
  name text not null,
  description text,
  category text,
  image_url text,
  cost_price numeric(12,2) not null default 0 check (cost_price >= 0),
  default_price numeric(12,2) not null default 0 check (default_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists products_user_sku_unique on public.products(user_id, lower(sku)) where sku is not null and sku <> '';

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  sku text,
  attributes jsonb not null default '{}'::jsonb,
  barcode text,
  created_at timestamptz not null default now()
);
create unique index if not exists variants_user_sku_unique on public.product_variants(user_id, lower(sku)) where sku is not null and sku <> '';

create table if not exists public.inventory (
  variant_id uuid primary key references public.product_variants(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0 and reserved_quantity <= quantity),
  min_quantity integer not null default 0 check (min_quantity >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  movement_type text not null check (movement_type in ('in','out','adjustment','reserve','release','sale','return')),
  quantity_delta integer not null,
  reason text,
  reference_type text,
  reference_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  connection_id uuid references public.marketplace_connections(id) on delete set null,
  platform text not null check (platform in ('mercado_livre','shopee')),
  external_item_id text not null,
  external_variant_id text,
  variant_id uuid references public.product_variants(id) on delete set null,
  title text,
  price numeric(12,2) check (price is null or price >= 0),
  platform_stock integer,
  status text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, platform, external_item_id, external_variant_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  connection_id uuid references public.marketplace_connections(id) on delete set null,
  platform text not null check (platform in ('mercado_livre','shopee')),
  external_order_id text not null,
  status text not null default 'unknown',
  currency text not null default 'BRL',
  gross_amount numeric(12,2) not null default 0,
  ordered_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  raw_status text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, platform, external_order_id)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  listing_id uuid references public.marketplace_listings(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  external_item_id text,
  external_variant_id text,
  title text not null,
  sku text,
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  discount_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.order_financials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  gross_amount numeric(12,2) not null default 0,
  discounts numeric(12,2) not null default 0,
  marketplace_fees numeric(12,2),
  shipping_cost numeric(12,2),
  taxes numeric(12,2),
  refunds numeric(12,2),
  net_amount numeric(12,2),
  payout_amount numeric(12,2),
  currency text not null default 'BRL',
  source text not null default 'marketplace_api',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('mercado_livre','shopee')),
  job_type text not null,
  status text not null default 'pending' check (status in ('pending','running','succeeded','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('mercado_livre','shopee')),
  event_key text not null,
  topic text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  unique(platform, event_key)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists orders_user_ordered_at_idx on public.orders(user_id, ordered_at desc);
create index if not exists orders_platform_status_idx on public.orders(user_id, platform, status);
create index if not exists inventory_user_idx on public.inventory(user_id);
create index if not exists listings_variant_idx on public.marketplace_listings(variant_id);
create index if not exists sync_jobs_ready_idx on public.sync_jobs(status, next_attempt_at);

-- Cria o perfil quando um usuário é criado no Supabase Auth.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name) values (new.id, coalesce(new.raw_user_meta_data->>'name',''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Função atômica: só ajusta se a quantidade final continuar >= reservado e >= 0.
create or replace function public.adjust_inventory(p_variant_id uuid, p_delta integer, p_reason text default 'Ajuste manual')
returns public.inventory
language plpgsql
security invoker
set search_path = public
as $$
declare result public.inventory;
begin
  if p_delta = 0 then raise exception 'O ajuste precisa ser diferente de zero'; end if;

  update public.inventory
     set quantity = quantity + p_delta, updated_at = now()
   where variant_id = p_variant_id
     and user_id = auth.uid()
     and quantity + p_delta >= reserved_quantity
     and quantity + p_delta >= 0
  returning * into result;

  if not found then raise exception 'Estoque inexistente ou ajuste inválido'; end if;

  insert into public.inventory_movements(user_id, variant_id, movement_type, quantity_delta, reason)
  values (auth.uid(), p_variant_id, 'adjustment', p_delta, p_reason);

  return result;
end;
$$;

-- RLS: cada tabela operacional só permite ao usuário autenticado acessar os próprios registros.
alter table public.profiles enable row level security;
alter table public.marketplace_connections enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_financials enable row level security;
alter table public.sync_jobs enable row level security;
alter table public.webhook_events enable row level security;
alter table public.audit_logs enable row level security;

create policy "profile own read" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profile own update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "connections own all" on public.marketplace_connections for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "products own all" on public.products for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "variants own all" on public.product_variants for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "inventory own read" on public.inventory for select to authenticated using (user_id = auth.uid());
create policy "inventory own insert" on public.inventory for insert to authenticated with check (user_id = auth.uid());
create policy "inventory own update" on public.inventory for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "movements own read" on public.inventory_movements for select to authenticated using (user_id = auth.uid());
create policy "listings own all" on public.marketplace_listings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "orders own read" on public.orders for select to authenticated using (user_id = auth.uid());
create policy "order items own read" on public.order_items for select to authenticated using (user_id = auth.uid());
create policy "financials own read" on public.order_financials for select to authenticated using (user_id = auth.uid());
create policy "sync jobs own read" on public.sync_jobs for select to authenticated using (user_id = auth.uid());
create policy "audit own read" on public.audit_logs for select to authenticated using (user_id = auth.uid());

-- webhook_events deliberadamente não tem política para o navegador: escrita/leitura via backend privilegiado.
-- Não conceda acesso público a tokens, eventos ou tarefas de sincronização.
grant execute on function public.adjust_inventory(uuid, integer, text) to authenticated;
