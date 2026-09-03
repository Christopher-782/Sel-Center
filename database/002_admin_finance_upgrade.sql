-- SEL Center Admin + Finance upgrade
-- Run this AFTER 001_operations_upgrade.sql.


-- Keep the Admin Dashboard strictly role-admin only. Per-user overrides can never grant it.
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
    where rp.role=me.role
  ), effective as (
    select p.permission_key from public.permissions p, me where me.role='admin'
    union
    select b.permission_key
    from base b, me
    where me.role<>'admin'
      and b.permission_key<>'admin_dashboard'
      and not exists (
        select 1 from public.user_permissions up
        where up.user_id=me.user_id and up.permission_key=b.permission_key and up.granted=false
      )
    union
    select up.permission_key
    from public.user_permissions up, me
    where me.role<>'admin'
      and up.user_id=me.user_id
      and up.granted=true
      and up.permission_key<>'admin_dashboard'
  )
  select e.permission_key from effective e order by e.permission_key;
$$;

grant execute on function public.get_my_permissions() to authenticated;

-- Historical cost snapshots for accurate gross-profit reporting.
alter table public.sale_items add column if not exists unit_cost numeric(12,2) not null default 0;
alter table public.ticket_packages add column if not exists cost_price numeric(12,2) not null default 0;

-- Expenses ledger (admin only).
create table if not exists public.expenses (
  id bigserial primary key,
  expense_reference text not null unique default ('EXP-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS')),
  category text not null,
  description text not null,
  amount numeric(12,2) not null check (amount >= 0),
  payment_mode text not null default 'cash' check (payment_mode in ('cash','card','transfer','other')),
  expense_date timestamptz not null default now(),
  notes text,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_expense_date_idx on public.expenses(expense_date desc);
create index if not exists expenses_category_idx on public.expenses(category);

-- Ticket audit trail.
create table if not exists public.ticket_audit_log (
  id bigserial primary key,
  ticket_id text,
  ticket_name text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists ticket_audit_log_changed_at_idx on public.ticket_audit_log(changed_at desc);

create or replace function public.log_ticket_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='INSERT' then
    insert into public.ticket_audit_log(ticket_id,ticket_name,action,old_data,new_data,changed_by)
    values(new.id::text,new.package_name,'CREATE',null,to_jsonb(new),auth.uid());
    return new;
  elsif tg_op='UPDATE' then
    insert into public.ticket_audit_log(ticket_id,ticket_name,action,old_data,new_data,changed_by)
    values(new.id::text,new.package_name,'UPDATE',to_jsonb(old),to_jsonb(new),auth.uid());
    return new;
  else
    insert into public.ticket_audit_log(ticket_id,ticket_name,action,old_data,new_data,changed_by)
    values(old.id::text,old.package_name,'DELETE',to_jsonb(old),null,auth.uid());
    return old;
  end if;
end;
$$;

drop trigger if exists trg_ticket_audit on public.ticket_packages;
create trigger trg_ticket_audit
after insert or update or delete on public.ticket_packages
for each row execute function public.log_ticket_change();

-- Recreate POS sale function so every sale stores the cost at the time of sale.
create or replace function public.process_pos_sale(
  p_sale_type text,
  p_payment_mode text,
  p_items jsonb,
  p_sale_date timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_item jsonb;
  v_id text;
  v_qty integer;
  v_name text;
  v_price numeric(12,2);
  v_cost numeric(12,2);
  v_total numeric(12,2):=0;
  v_sale_id bigint;
  v_reference text;
  v_updated integer;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_sale_type not in ('kitchen','ticket') then raise exception 'Invalid sale type'; end if;
  if p_payment_mode not in ('cash','card','transfer') then raise exception 'Invalid payment method'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'No sale items supplied'; end if;
  if p_sale_type='kitchen' and not public.user_has_permission('kitchen_pos') then raise exception 'Kitchen POS permission required'; end if;
  if p_sale_type='ticket' and not public.user_has_permission('ticket_pos') then raise exception 'Ticket POS permission required'; end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_id:=v_item->>'id';
    v_qty:=coalesce((v_item->>'quantity')::integer,0);
    if v_qty<=0 then raise exception 'Invalid item quantity'; end if;

    if p_sale_type='kitchen' then
      select i.name,i.price,coalesce(i.cost_price,0) into v_name,v_price,v_cost
      from public.inventory_items i where i.id::text=v_id and i.is_active=true;
      if not found then raise exception 'Kitchen product % not found',v_id; end if;
      if (select i.quantity from public.inventory_items i where i.id::text=v_id) < v_qty then raise exception 'Insufficient stock for %',v_name; end if;
    else
      select t.package_name,t.price,0::numeric into v_name,v_price,v_cost
      from public.ticket_packages t where t.id::text=v_id and t.is_active=true;
      if not found then raise exception 'Ticket % not found',v_id; end if;
      if (select t.quantity from public.ticket_packages t where t.id::text=v_id) < v_qty then raise exception 'Insufficient ticket stock for %',v_name; end if;
    end if;
    v_total:=v_total+(v_price*v_qty);
  end loop;

  v_reference:=(case when p_sale_type='kitchen' then 'KIT-' else 'TKT-' end)||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS');
  insert into public.sales(sale_reference,payment_mode,total_amount,sold_by,sale_type,sale_date,created_at)
  values(v_reference,p_payment_mode,v_total,auth.uid(),p_sale_type,coalesce(p_sale_date,now()),coalesce(p_sale_date,now()))
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_id:=v_item->>'id';
    v_qty:=(v_item->>'quantity')::integer;
    if p_sale_type='kitchen' then
      select i.name,i.price,coalesce(i.cost_price,0) into v_name,v_price,v_cost from public.inventory_items i where i.id::text=v_id;
      update public.inventory_items set quantity=quantity-v_qty,updated_at=now()
      where id::text=v_id and quantity>=v_qty;
      get diagnostics v_updated=row_count;
      if v_updated<>1 then raise exception 'Stock changed; insufficient stock for %',v_name; end if;
      insert into public.sale_items(sale_id,product_type,product_id,item_name,quantity,unit_price,unit_cost,total_price)
      values(v_sale_id,'inventory_items',v_id,v_name,v_qty,v_price,v_cost,v_price*v_qty);
    else
      select t.package_name,t.price,0::numeric into v_name,v_price,v_cost from public.ticket_packages t where t.id::text=v_id;
      update public.ticket_packages set quantity=quantity-v_qty,updated_at=now()
      where id::text=v_id and quantity>=v_qty;
      get diagnostics v_updated=row_count;
      if v_updated<>1 then raise exception 'Stock changed; insufficient ticket stock for %',v_name; end if;
      insert into public.sale_items(sale_id,product_type,product_id,item_name,quantity,unit_price,unit_cost,total_price)
      values(v_sale_id,'ticket_packages',v_id,v_name,v_qty,v_price,v_cost,v_price*v_qty);
    end if;
  end loop;

  return jsonb_build_object('sale_id',v_sale_id,'sale_reference',v_reference,'total_amount',v_total,'sale_type',p_sale_type);
end;
$$;

grant execute on function public.process_pos_sale(text,text,jsonb,timestamptz) to authenticated;

-- Admin-only sale editor. It restores old stock and applies the replacement sale atomically.
create or replace function public.admin_replace_sale(
  p_sale_id bigint,
  p_sale_type text,
  p_payment_mode text,
  p_items jsonb,
  p_sale_date timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_sale public.sales%rowtype;
  v_old public.sale_items%rowtype;
  v_item jsonb;
  v_id text;
  v_qty integer;
  v_name text;
  v_price numeric(12,2);
  v_cost numeric(12,2);
  v_total numeric(12,2):=0;
  v_updated integer;
begin
  if auth.uid() is null or not public.user_has_permission('admin_dashboard') then raise exception 'Administrator permission required'; end if;
  if p_sale_type not in ('kitchen','ticket') then raise exception 'Invalid sale type'; end if;
  if p_payment_mode not in ('cash','card','transfer') then raise exception 'Invalid payment method'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'No sale items supplied'; end if;

  select * into v_sale from public.sales where id=p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;

  -- Restore stock from the previous sale.
  for v_old in select * from public.sale_items where sale_id=p_sale_id
  loop
    if v_old.product_type='inventory_items' then
      update public.inventory_items set quantity=quantity+v_old.quantity,updated_at=now() where id::text=v_old.product_id;
    elsif v_old.product_type='ticket_packages' then
      update public.ticket_packages set quantity=quantity+v_old.quantity,updated_at=now() where id::text=v_old.product_id;
    end if;
  end loop;
  delete from public.sale_items where sale_id=p_sale_id;

  -- Validate stock and apply replacement items. Submitted price/cost snapshots are preserved for historical accuracy.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_id:=v_item->>'id';
    v_qty:=coalesce((v_item->>'quantity')::integer,0);
    if v_qty<=0 then raise exception 'Invalid item quantity'; end if;

    if p_sale_type='kitchen' then
      select i.name,i.price,coalesce(i.cost_price,0) into v_name,v_price,v_cost
      from public.inventory_items i where i.id::text=v_id;
      if not found then raise exception 'Kitchen product % not found',v_id; end if;
      if v_item ? 'unit_price' then v_price:=greatest(0,(v_item->>'unit_price')::numeric); end if;
      if v_item ? 'unit_cost' then v_cost:=greatest(0,(v_item->>'unit_cost')::numeric); end if;
      update public.inventory_items set quantity=quantity-v_qty,updated_at=now()
      where id::text=v_id and quantity>=v_qty;
      get diagnostics v_updated=row_count;
      if v_updated<>1 then raise exception 'Insufficient stock for %',v_name; end if;
      insert into public.sale_items(sale_id,product_type,product_id,item_name,quantity,unit_price,unit_cost,total_price)
      values(p_sale_id,'inventory_items',v_id,v_name,v_qty,v_price,v_cost,v_price*v_qty);
    else
      select t.package_name,t.price,0::numeric into v_name,v_price,v_cost
      from public.ticket_packages t where t.id::text=v_id;
      if not found then raise exception 'Ticket % not found',v_id; end if;
      if v_item ? 'unit_price' then v_price:=greatest(0,(v_item->>'unit_price')::numeric); end if;
      if v_item ? 'unit_cost' then v_cost:=greatest(0,(v_item->>'unit_cost')::numeric); end if;
      update public.ticket_packages set quantity=quantity-v_qty,updated_at=now()
      where id::text=v_id and quantity>=v_qty;
      get diagnostics v_updated=row_count;
      if v_updated<>1 then raise exception 'Insufficient ticket stock for %',v_name; end if;
      insert into public.sale_items(sale_id,product_type,product_id,item_name,quantity,unit_price,unit_cost,total_price)
      values(p_sale_id,'ticket_packages',v_id,v_name,v_qty,v_price,v_cost,v_price*v_qty);
    end if;
    v_total:=v_total+(v_price*v_qty);
  end loop;

  update public.sales
  set payment_mode=p_payment_mode,total_amount=v_total,sale_type=p_sale_type,sale_date=coalesce(p_sale_date,now())
  where id=p_sale_id;

  return jsonb_build_object('sale_id',p_sale_id,'sale_reference',v_sale.sale_reference,'total_amount',v_total,'sale_type',p_sale_type);
end;
$$;

grant execute on function public.admin_replace_sale(bigint,text,text,jsonb,timestamptz) to authenticated;

create or replace function public.admin_delete_sale(p_sale_id bigint)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_old public.sale_items%rowtype;
begin
  if auth.uid() is null or not public.user_has_permission('admin_dashboard') then raise exception 'Administrator permission required'; end if;
  if not exists(select 1 from public.sales where id=p_sale_id) then raise exception 'Sale not found'; end if;

  for v_old in select * from public.sale_items where sale_id=p_sale_id
  loop
    if v_old.product_type='inventory_items' then
      update public.inventory_items set quantity=quantity+v_old.quantity,updated_at=now() where id::text=v_old.product_id;
    elsif v_old.product_type='ticket_packages' then
      update public.ticket_packages set quantity=quantity+v_old.quantity,updated_at=now() where id::text=v_old.product_id;
    end if;
  end loop;
  delete from public.sales where id=p_sale_id;
end;
$$;

grant execute on function public.admin_delete_sale(bigint) to authenticated;

-- Financial summary for the admin dashboard and profit report.
create or replace function public.get_admin_financial_summary(p_start timestamptz, p_end timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_kitchen numeric(14,2):=0;
  v_ticket numeric(14,2):=0;
  v_gate numeric(14,2):=0;
  v_cogs numeric(14,2):=0;
  v_expenses numeric(14,2):=0;
  v_transactions bigint:=0;
  v_revenue numeric(14,2):=0;
  v_gross numeric(14,2):=0;
  v_net numeric(14,2):=0;
begin
  if auth.uid() is null or not public.user_has_permission('admin_dashboard') then raise exception 'Administrator permission required'; end if;

  select coalesce(sum(total_amount) filter(where sale_type='kitchen'),0),
         coalesce(sum(total_amount) filter(where sale_type='ticket'),0),
         count(*)
  into v_kitchen,v_ticket,v_transactions
  from public.sales
  where coalesce(sale_date,created_at)>=p_start and coalesce(sale_date,created_at)<p_end;

  select coalesce(sum(g.amount),0) into v_gate
  from public.gate_fee_records g
  where g.entry_at>=p_start and g.entry_at<p_end;

  select coalesce(sum(si.quantity*coalesce(si.unit_cost,0)),0) into v_cogs
  from public.sale_items si
  join public.sales s on s.id=si.sale_id
  where s.sale_type='kitchen'
    and coalesce(s.sale_date,s.created_at)>=p_start and coalesce(s.sale_date,s.created_at)<p_end;

  select coalesce(sum(e.amount),0) into v_expenses
  from public.expenses e
  where e.expense_date>=p_start and e.expense_date<p_end;

  v_revenue:=v_kitchen+v_ticket+v_gate;
  v_gross:=v_revenue-v_cogs;
  v_net:=v_gross-v_expenses;

  return jsonb_build_object(
    'kitchen_revenue',v_kitchen,
    'ticket_revenue',v_ticket,
    'gate_revenue',v_gate,
    'total_revenue',v_revenue,
    'cogs',v_cogs,
    'gross_profit',v_gross,
    'expenses',v_expenses,
    'net_profit',v_net,
    'sales_transactions',v_transactions
  );
end;
$$;

grant execute on function public.get_admin_financial_summary(timestamptz,timestamptz) to authenticated;

-- RLS for new finance/audit tables.
alter table public.expenses enable row level security;
alter table public.ticket_audit_log enable row level security;

drop policy if exists sel_expenses_admin on public.expenses;
create policy sel_expenses_admin on public.expenses for all to authenticated
using (public.user_has_permission('admin_dashboard'))
with check (public.user_has_permission('admin_dashboard'));

drop policy if exists sel_ticket_audit_admin on public.ticket_audit_log;
create policy sel_ticket_audit_admin on public.ticket_audit_log for select to authenticated
using (public.user_has_permission('admin_dashboard'));

grant select,insert,update,delete on public.expenses to authenticated;
grant select on public.ticket_audit_log to authenticated;
grant usage,select on sequence public.expenses_id_seq, public.ticket_audit_log_id_seq to authenticated;
