-- SEL Center inventory schema compatibility fix
-- Run this after migrations 001-004 if inventory_items existed before the operations upgrade.
-- Safe to run more than once.

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

update public.inventory_items
set department = coalesce(department, 'kitchen'),
    price = coalesce(price, 0),
    cost_price = coalesce(cost_price, 0),
    quantity = coalesce(quantity, 0),
    low_stock_threshold = coalesce(low_stock_threshold, 5),
    is_active = coalesce(is_active, true),
    updated_at = coalesce(updated_at, now());

-- Ask PostgREST to refresh its schema metadata immediately.
notify pgrst, 'reload schema';
