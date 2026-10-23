-- Cadastro atomico de produtos/variacoes/estoque e operacoes rastreaveis.
alter table public.products
  add column if not exists creation_request_id uuid;

create unique index if not exists products_user_creation_request_unique
  on public.products(user_id, creation_request_id)
  where creation_request_id is not null;

alter table public.inventory_movements
  add column if not exists request_id uuid;

create unique index if not exists inventory_movements_user_request_unique
  on public.inventory_movements(user_id, request_id)
  where request_id is not null;

create unique index if not exists product_variants_product_attributes_unique
  on public.product_variants(user_id, product_id, attributes);

create index if not exists inventory_movements_variant_created_idx
  on public.inventory_movements(variant_id, created_at desc);

drop policy if exists "products own all" on public.products;
create policy "products own read" on public.products
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "variants own all" on public.product_variants;
drop policy if exists "variants own read" on public.product_variants;
create policy "variants own read" on public.product_variants
  for select to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.products p
      where p.id = product_variants.product_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "inventory own read" on public.inventory;
drop policy if exists "inventory own insert" on public.inventory;
drop policy if exists "inventory own update" on public.inventory;
create policy "inventory own read" on public.inventory
  for select to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.product_variants v
      where v.id = inventory.variant_id and v.user_id = auth.uid()
    )
  );

drop policy if exists "movements own read" on public.inventory_movements;
create policy "movements own read" on public.inventory_movements
  for select to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.product_variants v
      where v.id = inventory_movements.variant_id and v.user_id = auth.uid()
    )
  );

create or replace function public.save_product_with_variants(
  p_product_id uuid,
  p_request_id uuid,
  p_name text,
  p_sku text,
  p_description text,
  p_cost_price numeric,
  p_default_price numeric,
  p_variants jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_product_id uuid;
  v_variant jsonb;
  v_variant_id uuid;
  v_attributes jsonb;
  v_sku text;
  v_size text;
  v_color text;
  v_quantity integer;
  v_min_quantity integer;
begin
  if v_user_id is null then
    raise exception 'É necessário estar autenticado para salvar produtos.';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'O nome do produto é obrigatório.';
  end if;
  if length(trim(p_name)) > 200 or length(trim(coalesce(p_sku, ''))) > 120 then
    raise exception 'O nome pode ter até 200 caracteres e o SKU do produto até 120.';
  end if;
  if p_cost_price is null or p_cost_price < 0
     or p_cost_price::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'O custo precisa ser um valor válido e não negativo.';
  end if;
  if p_default_price is null or p_default_price < 0
     or p_default_price::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'O preço precisa ser um valor válido e não negativo.';
  end if;
  if p_variants is null or jsonb_typeof(p_variants) <> 'array' then
    raise exception 'As variações precisam ser enviadas como uma lista.';
  end if;
  if p_product_id is null and jsonb_array_length(p_variants) = 0 then
    raise exception 'Cadastre ao menos uma variação, mesmo para produtos sem tamanho ou cor.';
  end if;
  if p_product_id is null and p_request_id is null then
    raise exception 'A solicitação de cadastro precisa de um identificador.';
  end if;

  if p_product_id is null then
    insert into public.products (
      user_id, creation_request_id, name, sku, description, cost_price, default_price
    )
    values (
      v_user_id, p_request_id, trim(p_name), nullif(trim(p_sku), ''),
      nullif(trim(p_description), ''), p_cost_price, p_default_price
    )
    on conflict (user_id, creation_request_id)
      where creation_request_id is not null
      do update set
        name = excluded.name,
        sku = excluded.sku,
        description = excluded.description,
        cost_price = excluded.cost_price,
        default_price = excluded.default_price,
        updated_at = now()
    returning id into v_product_id;
  else
    update public.products
       set name = trim(p_name),
           sku = nullif(trim(p_sku), ''),
           description = nullif(trim(p_description), ''),
           cost_price = p_cost_price,
           default_price = p_default_price,
           updated_at = now()
     where id = p_product_id and user_id = v_user_id
    returning id into v_product_id;

    if v_product_id is null then
      raise exception 'Produto não encontrado ou sem permissão para alterá-lo.';
    end if;
  end if;

  for v_variant in select value from jsonb_array_elements(p_variants)
  loop
    if jsonb_typeof(v_variant) <> 'object' then
      raise exception 'Cada variação precisa ser um objeto válido.';
    end if;

    if coalesce(v_variant->>'initial_quantity', '') !~ '^[0-9]+$'
       or coalesce(v_variant->>'min_quantity', '') !~ '^[0-9]+$' then
      raise exception 'As quantidades inicial e mínima devem ser números inteiros não negativos.';
    end if;

    v_quantity := (v_variant->>'initial_quantity')::integer;
    v_min_quantity := (v_variant->>'min_quantity')::integer;
    v_sku := nullif(trim(v_variant->>'sku'), '');
    v_size := nullif(trim(v_variant->>'size'), '');
    v_color := nullif(trim(v_variant->>'color'), '');
    v_attributes := jsonb_strip_nulls(jsonb_build_object('size', v_size, 'color', v_color));

    if v_variant ? 'sku' and jsonb_typeof(v_variant->'sku') not in ('string', 'null') then
      raise exception 'O SKU da variação precisa ser texto.';
    end if;
    if v_variant ? 'size' and jsonb_typeof(v_variant->'size') not in ('string', 'null') then
      raise exception 'O tamanho da variação precisa ser texto.';
    end if;
    if v_variant ? 'color' and jsonb_typeof(v_variant->'color') not in ('string', 'null') then
      raise exception 'A cor da variação precisa ser texto.';
    end if;
    if length(coalesce(v_sku, '')) > 120
       or length(coalesce(v_size, '')) > 80
       or length(coalesce(v_color, '')) > 100 then
      raise exception 'O SKU, tamanho ou cor excede o limite de caracteres permitido.';
    end if;

    insert into public.product_variants (user_id, product_id, sku, attributes)
    values (v_user_id, v_product_id, v_sku, v_attributes)
    on conflict (user_id, product_id, attributes) do nothing
    returning id into v_variant_id;

    if v_variant_id is null then
      continue;
    end if;

    insert into public.inventory (variant_id, user_id, quantity, min_quantity)
    values (v_variant_id, v_user_id, v_quantity, v_min_quantity);

    if v_quantity > 0 then
      insert into public.inventory_movements (
        user_id, variant_id, movement_type, quantity_delta, reason
      )
      values (v_user_id, v_variant_id, 'in', v_quantity, 'Estoque inicial');
    end if;
  end loop;

  return v_product_id;
end;
$$;

create or replace function public.move_inventory(
  p_variant_id uuid,
  p_delta integer,
  p_reason text default 'Ajuste manual',
  p_movement_type text default 'adjustment',
  p_request_id uuid default null
)
returns public.inventory
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.inventory_movements;
  v_result public.inventory;
begin
  if v_user_id is null then
    raise exception 'É necessário estar autenticado para movimentar o estoque.';
  end if;
  if p_variant_id is null or p_delta is null or p_delta = 0 then
    raise exception 'Informe uma variação e uma quantidade diferente de zero.';
  end if;
  if p_movement_type is null or p_movement_type not in ('in', 'out', 'adjustment') then
    raise exception 'Tipo de movimentação inválido.';
  end if;
  if (p_movement_type = 'in' and p_delta < 0)
     or (p_movement_type = 'out' and p_delta > 0) then
    raise exception 'O sinal da quantidade não corresponde ao tipo de movimentação.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Informe uma justificativa para a movimentação.';
  end if;

  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_request_id::text));
    select * into v_existing
      from public.inventory_movements
     where user_id = v_user_id and request_id = p_request_id;

    if found then
      if v_existing.variant_id <> p_variant_id
         or v_existing.quantity_delta <> p_delta
         or v_existing.movement_type <> p_movement_type
         or v_existing.reason is distinct from trim(p_reason) then
        raise exception 'O identificador da solicitação já foi usado em outra movimentação.';
      end if;

      select * into v_result
        from public.inventory
       where variant_id = p_variant_id and user_id = v_user_id;
      if not found then
        raise exception 'Estoque não encontrado para esta variação.';
      end if;
      return v_result;
    end if;
  end if;

  update public.inventory
     set quantity = quantity + p_delta,
         updated_at = now()
   where variant_id = p_variant_id
     and user_id = v_user_id
     and quantity + p_delta >= reserved_quantity
     and quantity + p_delta >= 0
  returning * into v_result;

  if not found then
    raise exception 'Estoque inexistente ou quantidade resultante inferior ao reservado/zero.';
  end if;

  insert into public.inventory_movements (
    user_id, variant_id, movement_type, quantity_delta, reason, request_id
  )
  values (v_user_id, p_variant_id, p_movement_type, p_delta, trim(p_reason), p_request_id);

  return v_result;
end;
$$;

create or replace function public.adjust_inventory(
  p_variant_id uuid,
  p_delta integer,
  p_reason text default 'Ajuste manual'
)
returns public.inventory
language sql
security invoker
set search_path = public, pg_temp
as $$
  select public.move_inventory(p_variant_id, p_delta, p_reason, 'adjustment', null);
$$;

revoke all on function public.save_product_with_variants(uuid, uuid, text, text, text, numeric, numeric, jsonb) from public;
revoke all on function public.save_product_with_variants(uuid, uuid, text, text, text, numeric, numeric, jsonb) from anon;
grant execute on function public.save_product_with_variants(uuid, uuid, text, text, text, numeric, numeric, jsonb) to authenticated;

revoke all on function public.move_inventory(uuid, integer, text, text, uuid) from public;
revoke all on function public.move_inventory(uuid, integer, text, text, uuid) from anon;
grant execute on function public.move_inventory(uuid, integer, text, text, uuid) to authenticated;

revoke all on function public.adjust_inventory(uuid, integer, text) from public;
revoke all on function public.adjust_inventory(uuid, integer, text) from anon;
grant execute on function public.adjust_inventory(uuid, integer, text) to authenticated;
