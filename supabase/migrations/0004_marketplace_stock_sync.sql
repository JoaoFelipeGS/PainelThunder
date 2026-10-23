alter table public.marketplace_listings
  add column if not exists sync_lock_until timestamptz;

create index if not exists sync_jobs_marketplace_ready_idx
  on public.sync_jobs(status, next_attempt_at, created_at)
  where job_type = 'publish_inventory';

create or replace function public.enqueue_inventory_marketplace_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.quantity is not distinct from old.quantity
     and new.reserved_quantity is not distinct from old.reserved_quantity then
    return new;
  end if;

  insert into public.sync_jobs (user_id, platform, job_type, payload)
  select distinct
    listing.user_id,
    listing.platform,
    'publish_inventory',
    jsonb_build_object(
      'listing_id', listing.id,
      'variant_id', listing.variant_id
    )
  from public.marketplace_listings listing
  join public.marketplace_connections connection
    on connection.id = listing.connection_id
   and connection.user_id = listing.user_id
   and connection.status = 'connected'
  where listing.variant_id = new.variant_id
    and listing.user_id = new.user_id
    and listing.connection_id is not null
    and listing.status is distinct from 'closed';

  return new;
end;
$$;

drop trigger if exists inventory_enqueue_marketplace_sync on public.inventory;
create trigger inventory_enqueue_marketplace_sync
after insert or update of quantity, reserved_quantity on public.inventory
for each row execute function public.enqueue_inventory_marketplace_sync();

create or replace function public.claim_marketplace_sync_jobs(p_limit integer default 20)
returns setof public.sync_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'A operação exige acesso de servidor.';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Limite de tarefas inválido.';
  end if;

  return query
  with ready as (
    select job.id
    from public.sync_jobs job
    where job.job_type = 'publish_inventory'
      and job.status in ('pending', 'failed')
      and job.next_attempt_at <= now()
    order by job.next_attempt_at, job.created_at
    for update skip locked
    limit p_limit
  )
  update public.sync_jobs job
     set status = 'running',
         attempts = job.attempts + 1,
         updated_at = now()
    from ready
   where job.id = ready.id
  returning job.*;
end;
$$;

create or replace function public.finish_marketplace_sync_job(
  p_job_id uuid,
  p_success boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'A operação exige acesso de servidor.';
  end if;

  select attempts into v_attempts
  from public.sync_jobs
  where id = p_job_id and status = 'running'
  for update;

  if not found then
    raise exception 'Tarefa de sincronização não encontrada ou não está em execução.';
  end if;

  update public.sync_jobs
     set status = case when p_success then 'succeeded' else 'failed' end,
         last_error = case when p_success then null else left(coalesce(p_error, 'Falha na sincronização.'), 500) end,
         next_attempt_at = case
           when p_success then now()
           else now() + make_interval(secs => least(3600, 15 * (2 ^ least(v_attempts, 8))::integer))
         end,
         updated_at = now()
   where id = p_job_id;
end;
$$;

revoke all on function public.claim_marketplace_sync_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_marketplace_sync_jobs(integer) to service_role;
revoke all on function public.finish_marketplace_sync_job(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.finish_marketplace_sync_job(uuid, boolean, text) to service_role;
