-- SEL Center operations upgrade
-- Run this once in the Supabase SQL Editor before using the new pages.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Existing operational tables: create when absent, then add required columns.
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'sale_associate',
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists role text default 'sale_associate';

create table if not exists public.inventory_items (
  id bigserial primary key,
  name text not null,
  sku text,
  price numeric(12,2) not null default 0,
  cost_price numeric(12,2) not null default 0,
  quantity integer not null default 0,
  low_stock_threshold integer not null default 5,
  category text,
  department text not null default 'kitchen',
  description text,
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.inventory_items add column if not exists sku text;
alter table public.inventory_items add column if not exists price numeric(12,2) default 0;
alter table public.inventory_items add column if not exists cost_price numeric(12,2) default 0;
alter table public.inventory_items add column if not exists quantity integer default 0;
alter table public.inventory_items add column if not exists low_stock_threshold integer default 5;
alter table public.inventory_items add column if not exists category text;
alter table public.inventory_items add column if not exists department text default 'kitchen';
alter table public.inventory_items add column if not exists description text;
alter table public.inventory_items add column if not exists image_url text;
alter table public.inventory_items add column if not exists is_active boolean default true;
alter table public.inventory_items add column if not exists created_at timestamptz default now();
alter table public.inventory_items add column if not exists updated_at timestamptz default now();

-- Normalize the categories used by Kitchen POS without touching unrelated categories.
update public.inventory_items set category='Drinks' where lower(coalesce(category,'')) in ('drink','drinks','beverage','beverages');
update public.inventory_items set category='Meals' where lower(coalesce(category,'')) in ('food','meal','meals');
update public.inventory_items set category='Desserts' where lower(coalesce(category,'')) in ('dessert','desserts','desert','deserts');

create table if not exists public.ticket_packages (
  id bigserial primary key,
  package_name text not null,
  price numeric(12,2) not null default 0,
  description text,
  audience text,
  ticket_type text,
  quantity integer not null default 0,
  low_stock_threshold integer not null default 20,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ticket_packages add column if not exists audience text;
alter table public.ticket_packages add column if not exists ticket_type text;
alter table public.ticket_packages add column if not exists quantity integer default 0;
alter table public.ticket_packages add column if not exists low_stock_threshold integer default 20;
alter table public.ticket_packages add column if not exists updated_at timestamptz default now();
alter table public.ticket_packages add column if not exists is_active boolean default true;

-- Seed the exact ticket types requested. Existing rows with the same names are reused.
insert into public.ticket_packages (package_name, audience, ticket_type, price, quantity, low_stock_threshold, is_active)
select v.package_name, v.audience, v.ticket_type, 0, 0, 20, true
from (values
 ('Outdoor Kids Ticket','kids','outdoor'),
 ('Indoor Kids Ticket','kids','indoor'),
 ('Kids Swimming Ticket','kids','swimming'),
 ('Premium Kids Ticket','kids','premium'),
 ('Outdoor Adult Ticket','adult','outdoor'),
 ('Indoor Adult Ticket','adult','indoor'),
 ('Swimming Adult Ticket','adult','swimming'),
 ('Premium Adult Ticket','adult','premium')
) as v(package_name,audience,ticket_type)
where not exists (
  select 1 from public.ticket_packages t where lower(t.package_name)=lower(v.package_name)
);

-- Backfill audience/type for seeded names that already existed.
update public.ticket_packages set audience='kids', ticket_type='outdoor' where lower(package_name)='outdoor kids ticket';
update public.ticket_packages set audience='kids', ticket_type='indoor' where lower(package_name)='indoor kids ticket';
update public.ticket_packages set audience='kids', ticket_type='swimming' where lower(package_name)='kids swimming ticket';
update public.ticket_packages set audience='kids', ticket_type='premium' where lower(package_name)='premium kids ticket';
update public.ticket_packages set audience='adult', ticket_type='outdoor' where lower(package_name)='outdoor adult ticket';
update public.ticket_packages set audience='adult', ticket_type='indoor' where lower(package_name)='indoor adult ticket';
update public.ticket_packages set audience='adult', ticket_type='swimming' where lower(package_name)='swimming adult ticket';
update public.ticket_packages set audience='adult', ticket_type='premium' where lower(package_name)='premium adult ticket';

create table if not exists public.sales (
  id bigserial primary key,
  sale_reference text not null,
  payment_mode text not null,
  total_amount numeric(12,2) not null default 0,
  sold_by uuid references auth.users(id),
  sale_type text not null default 'legacy',
  sale_date timestamptz,
  created_at timestamptz not null default now()
);
alter table public.sales add column if not exists sale_type text default 'legacy';
alter table public.sales add column if not exists sale_date timestamptz;
alter table public.sales add column if not exists created_at timestamptz default now();

create table if not exists public.sale_items (
  id bigserial primary key,
  sale_id bigint not null references public.sales(id) on delete cascade,
  product_type text,
  product_id text,
  item_name text,
  quantity integer not null default 1,
  unit_price numeric(12,2) not null default 0,
  total_price numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
alter table public.sale_items add column if not exists product_type text;
alter table public.sale_items add column if not exists product_id text;
alter table public.sale_items add column if not exists item_name text;
alter table public.sale_items add column if not exists quantity integer default 1;
alter table public.sale_items add column if not exists unit_price numeric(12,2) default 0;
alter table public.sale_items add column if not exists total_price numeric(12,2) default 0;

-- -----------------------------------------------------------------------------
-- Permission model
-- -----------------------------------------------------------------------------
create table if not exists public.permissions (
  permission_key text primary key,
  label text not null
);

create table if not exists public.role_permissions (
  role text not null,
  permission_key text not null references public.permissions(permission_key) on delete cascade,
  primary key (role, permission_key)
);

create table if not exists public.user_permissions (
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_key text not null references public.permissions(permission_key) on delete cascade,
  granted boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, permission_key)
);

insert into public.permissions(permission_key,label) values
 ('gate_entry','Record gate entry fees'),
 ('kitchen_pos','Use Kitchen POS'),
 ('ticket_pos','Use Ticket POS'),
 ('view_ticket_reports','View ticket sales reports'),
 ('view_kitchen_reports','View kitchen sales reports'),
 ('view_gate_reports','View gate fee reports'),
 ('manage_ticket_inventory','Manage ticket quantities'),
 ('manage_kitchen_inventory','Manage kitchen inventory'),
 ('manage_users','Create users and assign access'),
 ('view_audit_logs','View inventory audit logs'),
 ('admin_dashboard','Open admin dashboard')
on conflict(permission_key) do update set label=excluded.label;

-- Preserve the old roles while allowing per-user overrides.
insert into public.role_permissions(role,permission_key)
select 'admin', permission_key from public.permissions
on conflict do nothing;

insert into public.role_permissions(role,permission_key) values
 ('manager','kitchen_pos'),('manager','ticket_pos'),
 ('manager','view_ticket_reports'),('manager','view_kitchen_reports'),
 ('manager','manage_ticket_inventory'),('manager','manage_kitchen_inventory'),
 ('manager','view_audit_logs'),
 ('sale_associate','kitchen_pos'),('sale_associate','ticket_pos')
on conflict do nothing;

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
    -- Administrators always retain every permission.
    select p.permission_key from public.permissions p, me where me.role='admin'
    union
    select b.permission_key
    from base b, me
    where me.role<>'admin' and not exists (
      select 1 from public.user_permissions up
      where up.user_id=me.user_id and up.permission_key=b.permission_key and up.granted=false
    )
    union
    select up.permission_key
    from public.user_permissions up, me
    where me.role<>'admin' and up.user_id=me.user_id and up.granted=true
  )
  select e.permission_key from effective e order by e.permission_key;
$$;

grant execute on function public.get_my_permissions() to authenticated;

create or replace function public.user_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(select 1 from public.get_my_permissions() p where p.permission_key=p_permission);
$$;

grant execute on function public.user_has_permission(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Gate entry fees
-- -----------------------------------------------------------------------------
create table if not exists public.gate_fee_records (
  id bigserial primary key,
  receipt_no text not null unique,
  amount numeric(12,2) not null check(amount>=0),
  persons_count integer not null default 1 check(persons_count>0),
  payment_mode text not null check(payment_mode in ('cash','card','transfer')),
  payer_name text,
  notes text,
  recorded_by uuid not null references auth.users(id),
  entry_at timestamptz not null default now()
);
create index if not exists gate_fee_records_entry_at_idx on public.gate_fee_records(entry_at desc);

-- -----------------------------------------------------------------------------
-- Kitchen inventory audit trail
-- -----------------------------------------------------------------------------
create table if not exists public.inventory_audit_log (
  id bigserial primary key,
  product_id text,
  product_name text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists inventory_audit_log_changed_at_idx on public.inventory_audit_log(changed_at desc);

create or replace function public.log_inventory_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='INSERT' then
    insert into public.inventory_audit_log(product_id,product_name,action,old_data,new_data,changed_by)
    values(new.id::text,new.name,'CREATE',null,to_jsonb(new),auth.uid());
    return new;
  elsif tg_op='UPDATE' then
    insert into public.inventory_audit_log(product_id,product_name,action,old_data,new_data,changed_by)
    values(new.id::text,new.name,'UPDATE',to_jsonb(old),to_jsonb(new),auth.uid());
    return new;
  else
    insert into public.inventory_audit_log(product_id,product_name,action,old_data,new_data,changed_by)
    values(old.id::text,old.name,'DELETE',to_jsonb(old),null,auth.uid());
    return old;
  end if;
end;
$$;

drop trigger if exists trg_inventory_audit on public.inventory_items;
create trigger trg_inventory_audit
after insert or update or delete on public.inventory_items
for each row execute function public.log_inventory_change();

-- -----------------------------------------------------------------------------
-- Atomic Kitchen/Ticket POS sale function.
-- Prices are read from the database; the browser only submits IDs + quantities.
-- -----------------------------------------------------------------------------
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

  -- Validate and calculate total using server-side prices.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_id:=v_item->>'id'; v_qty:=coalesce((v_item->>'quantity')::integer,0);
    if v_qty<=0 then raise exception 'Invalid item quantity'; end if;
    if p_sale_type='kitchen' then
      select i.name,i.price into v_name,v_price
      from public.inventory_items i where i.id::text=v_id and i.is_active=true;
      if not found then raise exception 'Kitchen product % not found',v_id; end if;
      if (select i.quantity from public.inventory_items i where i.id::text=v_id) < v_qty then raise exception 'Insufficient stock for %',v_name; end if;
    else
      select t.package_name,t.price into v_name,v_price
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
    v_id:=v_item->>'id'; v_qty:=(v_item->>'quantity')::integer;
    if p_sale_type='kitchen' then
      select i.name,i.price into v_name,v_price from public.inventory_items i where i.id::text=v_id;
      update public.inventory_items set quantity=quantity-v_qty,updated_at=now()
      where id::text=v_id and quantity>=v_qty;
      get diagnostics v_updated=row_count;
      if v_updated<>1 then raise exception 'Stock changed; insufficient stock for %',v_name; end if;
      insert into public.sale_items(sale_id,product_type,product_id,item_name,quantity,unit_price,total_price)
      values(v_sale_id,'inventory_items',v_id,v_name,v_qty,v_price,v_price*v_qty);
    else
      select t.package_name,t.price into v_name,v_price from public.ticket_packages t where t.id::text=v_id;
      update public.ticket_packages set quantity=quantity-v_qty,updated_at=now()
      where id::text=v_id and quantity>=v_qty;
      get diagnostics v_updated=row_count;
      if v_updated<>1 then raise exception 'Stock changed; insufficient ticket stock for %',v_name; end if;
      insert into public.sale_items(sale_id,product_type,product_id,item_name,quantity,unit_price,total_price)
      values(v_sale_id,'ticket_packages',v_id,v_name,v_qty,v_price,v_price*v_qty);
    end if;
  end loop;

  return jsonb_build_object('sale_id',v_sale_id,'sale_reference',v_reference,'total_amount',v_total,'sale_type',p_sale_type);
end;
$$;

grant execute on function public.process_pos_sale(text,text,jsonb,timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permissions enable row level security;
alter table public.gate_fee_records enable row level security;
alter table public.inventory_audit_log enable row level security;
alter table public.inventory_items enable row level security;
alter table public.ticket_packages enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.profiles enable row level security;

drop policy if exists sel_permissions_read on public.permissions;
create policy sel_permissions_read on public.permissions for select to authenticated using (true);
drop policy if exists sel_role_permissions_read on public.role_permissions;
create policy sel_role_permissions_read on public.role_permissions for select to authenticated using (true);

drop policy if exists sel_user_permissions_read on public.user_permissions;
create policy sel_user_permissions_read on public.user_permissions for select to authenticated using (user_id=auth.uid() or public.user_has_permission('manage_users'));
drop policy if exists sel_user_permissions_write on public.user_permissions;
create policy sel_user_permissions_write on public.user_permissions for all to authenticated using (public.user_has_permission('manage_users')) with check (public.user_has_permission('manage_users'));

drop policy if exists sel_profiles_read on public.profiles;
create policy sel_profiles_read on public.profiles for select to authenticated using (id=auth.uid() or public.user_has_permission('manage_users') or public.user_has_permission('view_ticket_reports') or public.user_has_permission('view_kitchen_reports') or public.user_has_permission('view_gate_reports') or public.user_has_permission('admin_dashboard'));

drop policy if exists sel_gate_select on public.gate_fee_records;
create policy sel_gate_select on public.gate_fee_records for select to authenticated using (public.user_has_permission('gate_entry') or public.user_has_permission('view_gate_reports') or public.user_has_permission('admin_dashboard'));
drop policy if exists sel_gate_insert on public.gate_fee_records;
create policy sel_gate_insert on public.gate_fee_records for insert to authenticated with check (recorded_by=auth.uid() and public.user_has_permission('gate_entry'));

drop policy if exists sel_inventory_select on public.inventory_items;
create policy sel_inventory_select on public.inventory_items for select to authenticated using (public.user_has_permission('kitchen_pos') or public.user_has_permission('manage_kitchen_inventory') or public.user_has_permission('view_kitchen_reports') or public.user_has_permission('admin_dashboard'));
drop policy if exists sel_inventory_insert on public.inventory_items;
create policy sel_inventory_insert on public.inventory_items for insert to authenticated with check (public.user_has_permission('manage_kitchen_inventory') or public.user_has_permission('admin_dashboard'));
drop policy if exists sel_inventory_update on public.inventory_items;
create policy sel_inventory_update on public.inventory_items for update to authenticated using (public.user_has_permission('kitchen_pos') or public.user_has_permission('manage_kitchen_inventory') or public.user_has_permission('admin_dashboard')) with check (public.user_has_permission('kitchen_pos') or public.user_has_permission('manage_kitchen_inventory') or public.user_has_permission('admin_dashboard'));
drop policy if exists sel_inventory_delete on public.inventory_items;
create policy sel_inventory_delete on public.inventory_items for delete to authenticated using (public.user_has_permission('manage_kitchen_inventory') or public.user_has_permission('admin_dashboard'));

drop policy if exists sel_ticket_select on public.ticket_packages;
create policy sel_ticket_select on public.ticket_packages for select to authenticated using (public.user_has_permission('ticket_pos') or public.user_has_permission('manage_ticket_inventory') or public.user_has_permission('view_ticket_reports') or public.user_has_permission('admin_dashboard'));
drop policy if exists sel_ticket_update on public.ticket_packages;
create policy sel_ticket_update on public.ticket_packages for update to authenticated using (public.user_has_permission('manage_ticket_inventory') or public.user_has_permission('admin_dashboard')) with check (public.user_has_permission('manage_ticket_inventory') or public.user_has_permission('admin_dashboard'));
drop policy if exists sel_ticket_insert on public.ticket_packages;
create policy sel_ticket_insert on public.ticket_packages for insert to authenticated with check (public.user_has_permission('manage_ticket_inventory') or public.user_has_permission('admin_dashboard'));
drop policy if exists sel_ticket_delete on public.ticket_packages;
create policy sel_ticket_delete on public.ticket_packages for delete to authenticated using (public.user_has_permission('manage_ticket_inventory') or public.user_has_permission('admin_dashboard'));

drop policy if exists sel_sales_select on public.sales;
create policy sel_sales_select on public.sales for select to authenticated using (sold_by=auth.uid() or public.user_has_permission('view_ticket_reports') or public.user_has_permission('view_kitchen_reports') or public.user_has_permission('admin_dashboard'));
drop policy if exists sel_sales_insert on public.sales;
create policy sel_sales_insert on public.sales for insert to authenticated with check (sold_by=auth.uid() and (public.user_has_permission('kitchen_pos') or public.user_has_permission('ticket_pos')));

drop policy if exists sel_sale_items_select on public.sale_items;
create policy sel_sale_items_select on public.sale_items for select to authenticated using (public.user_has_permission('view_ticket_reports') or public.user_has_permission('view_kitchen_reports') or public.user_has_permission('admin_dashboard') or exists(select 1 from public.sales s where s.id=sale_items.sale_id and s.sold_by=auth.uid()));
drop policy if exists sel_sale_items_insert on public.sale_items;
create policy sel_sale_items_insert on public.sale_items for insert to authenticated with check (public.user_has_permission('kitchen_pos') or public.user_has_permission('ticket_pos'));

drop policy if exists sel_audit_read on public.inventory_audit_log;
create policy sel_audit_read on public.inventory_audit_log for select to authenticated using (public.user_has_permission('view_audit_logs') or public.user_has_permission('manage_kitchen_inventory') or public.user_has_permission('admin_dashboard'));

-- Helpful indexes for report filtering.
create index if not exists sales_sale_type_created_at_idx on public.sales(sale_type,created_at desc);
create index if not exists sale_items_sale_id_idx on public.sale_items(sale_id);
create index if not exists ticket_packages_audience_idx on public.ticket_packages(audience);


-- API grants (RLS policies above still decide which rows/actions are allowed).
grant select on public.permissions, public.role_permissions to authenticated;
grant select, insert, update, delete on public.user_permissions to authenticated;
grant select, insert on public.gate_fee_records to authenticated;
grant select on public.inventory_audit_log to authenticated;
grant select, insert, update, delete on public.inventory_items to authenticated;
grant select, insert, update, delete on public.ticket_packages to authenticated;
grant select, insert, update, delete on public.sales to authenticated;
grant select, insert, update, delete on public.sale_items to authenticated;
grant select on public.profiles to authenticated;
grant usage, select on sequence public.gate_fee_records_id_seq, public.inventory_audit_log_id_seq to authenticated;

-- Preserve administrative edit/delete operations used by the existing admin page.
drop policy if exists sel_sales_admin_update on public.sales;
create policy sel_sales_admin_update on public.sales for update to authenticated using (public.user_has_permission('admin_dashboard')) with check (public.user_has_permission('admin_dashboard'));
drop policy if exists sel_sales_admin_delete on public.sales;
create policy sel_sales_admin_delete on public.sales for delete to authenticated using (public.user_has_permission('admin_dashboard'));
drop policy if exists sel_sale_items_admin_delete on public.sale_items;
create policy sel_sale_items_admin_delete on public.sale_items for delete to authenticated using (public.user_has_permission('admin_dashboard'));
