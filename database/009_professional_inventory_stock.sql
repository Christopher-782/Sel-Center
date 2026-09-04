-- SEL Center professional Kitchen inventory replenishment
-- Run after 008_gate_entry_admin_crud.sql.
-- Safe for existing data. Adds an auditable stock-addition ledger and atomic RPC.

create table if not exists public.inventory_stock_movements (
  id bigserial primary key,
  product_id text not null,
  product_name text not null,
  movement_type text not null default 'RESTOCK' check (movement_type in ('RESTOCK')),
  quantity_added integer not null check (quantity_added > 0),
  quantity_before integer not null,
  quantity_after integer not null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inventory_stock_movements_product_idx
  on public.inventory_stock_movements(product_id, created_at desc);
create index if not exists inventory_stock_movements_created_at_idx
  on public.inventory_stock_movements(created_at desc);

alter table public.inventory_stock_movements enable row level security;

drop policy if exists sel_inventory_stock_movements_select on public.inventory_stock_movements;
create policy sel_inventory_stock_movements_select
on public.inventory_stock_movements for select to authenticated
using (
  public.user_has_permission('manage_kitchen_inventory')
  or public.user_has_permission('view_audit_logs')
  or public.user_has_permission('admin_dashboard')
);

-- Writes are performed only through the security-definer RPC below.
revoke insert, update, delete on public.inventory_stock_movements from authenticated;
grant select on public.inventory_stock_movements to authenticated;

create or replace function public.add_inventory_stock(
  p_product_id text,
  p_quantity integer,
  p_note text default null
)
returns table(
  product_id text,
  product_name text,
  old_quantity integer,
  quantity_added integer,
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
begin
  if not (
    public.user_has_permission('manage_kitchen_inventory')
    or public.user_has_permission('admin_dashboard')
  ) then
    raise exception 'You do not have permission to add Kitchen stock.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity to add must be greater than zero.';
  end if;

  select i.name, coalesce(i.quantity, 0)
    into v_name, v_before
  from public.inventory_items i
  where i.id::text = p_product_id
  for update;

  if not found then
    raise exception 'Kitchen product not found.';
  end if;

  v_after := v_before + p_quantity;

  update public.inventory_items i
  set quantity = v_after,
      updated_at = now()
  where i.id::text = p_product_id;

  insert into public.inventory_stock_movements(
    product_id, product_name, movement_type, quantity_added,
    quantity_before, quantity_after, note, created_by
  ) values (
    p_product_id, v_name, 'RESTOCK', p_quantity,
    v_before, v_after, nullif(trim(p_note), ''), auth.uid()
  );

  return query select p_product_id, v_name, v_before, p_quantity, v_after;
end;
$$;

grant execute on function public.add_inventory_stock(text, integer, text) to authenticated;
notify pgrst, 'reload schema';
