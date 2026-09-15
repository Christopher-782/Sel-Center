-- SEL Center inventory stock reduction support
-- Run after 010_role_finance_stock_permissions.sql.
-- Adds a persisted reduction ledger, fixes Super Admin permission resolution,
-- and exposes an atomic permission-protected stock reduction RPC.

create or replace function public.get_my_permissions()
returns table(permission_key text)
language sql
stable
security definer
set search_path=public
as $$
  with me as (
    select auth.uid() as user_id,
           lower(coalesce((select p.role from public.profiles p where p.id=auth.uid()), '')) as role
  ), base as (
    select rp.permission_key
    from public.role_permissions rp, me
    where lower(rp.role)=me.role
  ), effective as (
    -- Administrators and Super Administrators always retain every permission.
    select p.permission_key
    from public.permissions p, me
    where me.role in ('admin','super_admin')

    union

    select b.permission_key
    from base b, me
    where me.role not in ('admin','super_admin')
      and not exists (
        select 1
        from public.user_permissions up
        where up.user_id=me.user_id
          and up.permission_key=b.permission_key
          and up.granted=false
      )

    union

    select up.permission_key
    from public.user_permissions up, me
    where me.role not in ('admin','super_admin')
      and up.user_id=me.user_id
      and up.granted=true
  )
  select e.permission_key from effective e order by e.permission_key;
$$;

grant execute on function public.get_my_permissions() to authenticated;

create table if not exists public.inventory_stock_reductions (
  id bigserial primary key,
  product_id text not null,
  product_name text not null,
  quantity_removed integer not null check (quantity_removed > 0),
  quantity_before integer not null check (quantity_before >= 0),
  quantity_after integer not null check (quantity_after >= 0),
  reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inventory_stock_reductions_product_idx
  on public.inventory_stock_reductions(product_id, created_at desc);
create index if not exists inventory_stock_reductions_created_at_idx
  on public.inventory_stock_reductions(created_at desc);

alter table public.inventory_stock_reductions enable row level security;

drop policy if exists sel_inventory_stock_reductions_select on public.inventory_stock_reductions;
create policy sel_inventory_stock_reductions_select
on public.inventory_stock_reductions for select to authenticated
using (
  public.user_has_permission('reduce_stock')
  or public.user_has_permission('view_stock_history')
  or public.user_has_permission('view_audit_logs')
);

revoke insert, update, delete on public.inventory_stock_reductions from authenticated;
grant select on public.inventory_stock_reductions to authenticated;

create or replace function public.reduce_inventory_stock(
  p_product_id text,
  p_quantity integer,
  p_reason text
)
returns table(
  product_id text,
  product_name text,
  old_quantity integer,
  quantity_removed integer,
  new_quantity integer
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_name text;
  v_before integer;
  v_after integer;
  v_reason text;
begin
  if auth.uid() is null or not public.user_has_permission('reduce_stock') then
    raise exception 'You do not have permission to reduce inventory stock.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity to remove must be greater than zero.';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'A reason is required when reducing stock.';
  end if;

  select i.name, coalesce(i.quantity, 0)
    into v_name, v_before
  from public.inventory_items i
  where i.id::text = p_product_id
  for update;

  if not found then
    raise exception 'Kitchen product not found.';
  end if;

  if p_quantity > v_before then
    raise exception 'Cannot remove % item(s). Current stock is %.', p_quantity, v_before;
  end if;

  v_after := v_before - p_quantity;

  update public.inventory_items i
  set quantity = v_after,
      updated_at = now()
  where i.id::text = p_product_id;

  insert into public.inventory_stock_reductions(
    product_id, product_name, quantity_removed,
    quantity_before, quantity_after, reason, created_by
  ) values (
    p_product_id, v_name, p_quantity,
    v_before, v_after, v_reason, auth.uid()
  );

  return query
  select p_product_id, v_name, v_before, p_quantity, v_after;
end;
$$;

grant execute on function public.reduce_inventory_stock(text, integer, text) to authenticated;
notify pgrst, 'reload schema';
