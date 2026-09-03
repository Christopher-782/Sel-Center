-- SEL Center Reconciliation + Cash Change upgrade
-- Run this AFTER 001_operations_upgrade.sql and 002_admin_finance_upgrade.sql.

-- Dedicated permission that can be assigned to an accountant without granting the Admin Dashboard.
insert into public.permissions(permission_key,label) values
 ('reconcile_finance','Perform cash, card and transfer reconciliation')
on conflict(permission_key) do update set label=excluded.label;

-- Capture cash tendered and customer change on cash transactions.
alter table public.sales add column if not exists cash_received numeric(12,2);
alter table public.sales add column if not exists change_given numeric(12,2) not null default 0;
alter table public.gate_fee_records add column if not exists cash_received numeric(12,2);
alter table public.gate_fee_records add column if not exists change_given numeric(12,2) not null default 0;

-- Existing cash transactions did not store tendered cash. Treat their sale amount as the cash received.
update public.sales
set cash_received=total_amount, change_given=0
where payment_mode='cash' and cash_received is null;

update public.gate_fee_records
set cash_received=amount, change_given=0
where payment_mode='cash' and cash_received is null;

-- POS wrapper that records cash tendered and customer change while retaining the existing atomic stock logic.
create or replace function public.process_pos_sale_v2(
  p_sale_type text,
  p_payment_mode text,
  p_items jsonb,
  p_sale_date timestamptz default now(),
  p_cash_received numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_result jsonb;
  v_total numeric(12,2);
  v_sale_id bigint;
  v_received numeric(12,2);
  v_change numeric(12,2):=0;
begin
  v_result := public.process_pos_sale(p_sale_type,p_payment_mode,p_items,p_sale_date);
  v_total := coalesce((v_result->>'total_amount')::numeric,0);
  v_sale_id := (v_result->>'sale_id')::bigint;

  if p_payment_mode='cash' then
    v_received := coalesce(p_cash_received,v_total);
    if v_received < v_total then
      raise exception 'Cash received cannot be less than the sale total';
    end if;
    v_change := v_received-v_total;
    update public.sales set cash_received=v_received,change_given=v_change where id=v_sale_id;
  else
    update public.sales set cash_received=null,change_given=0 where id=v_sale_id;
  end if;

  return v_result || jsonb_build_object('cash_received',v_received,'change_given',v_change);
end;
$$;
grant execute on function public.process_pos_sale_v2(text,text,jsonb,timestamptz,numeric) to authenticated;

-- Admin sale editor wrapper with the same cash-change capture.
create or replace function public.admin_replace_sale_v2(
  p_sale_id bigint,
  p_sale_type text,
  p_payment_mode text,
  p_items jsonb,
  p_sale_date timestamptz,
  p_cash_received numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_result jsonb;
  v_total numeric(12,2);
  v_received numeric(12,2);
  v_change numeric(12,2):=0;
begin
  v_result := public.admin_replace_sale(p_sale_id,p_sale_type,p_payment_mode,p_items,p_sale_date);
  v_total := coalesce((v_result->>'total_amount')::numeric,0);

  if p_payment_mode='cash' then
    v_received := coalesce(p_cash_received,v_total);
    if v_received < v_total then
      raise exception 'Cash received cannot be less than the sale total';
    end if;
    v_change := v_received-v_total;
    update public.sales set cash_received=v_received,change_given=v_change where id=p_sale_id;
  else
    update public.sales set cash_received=null,change_given=0 where id=p_sale_id;
  end if;

  return v_result || jsonb_build_object('cash_received',v_received,'change_given',v_change);
end;
$$;
grant execute on function public.admin_replace_sale_v2(bigint,text,text,jsonb,timestamptz,numeric) to authenticated;

-- Saved reconciliation snapshots.
create table if not exists public.reconciliation_records (
  id bigserial primary key,
  reconciliation_reference text not null unique default ('REC-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS')),
  period_type text not null check (period_type in ('daily','weekly','custom')),
  period_start timestamptz not null,
  period_end timestamptz not null,

  gross_cash_received numeric(14,2) not null default 0,
  customer_change_given numeric(14,2) not null default 0,
  net_cash_sales numeric(14,2) not null default 0,
  cash_expenses numeric(14,2) not null default 0,
  expected_cash numeric(14,2) not null default 0,
  actual_cash numeric(14,2) not null default 0,
  cash_variance numeric(14,2) not null default 0,

  expected_card numeric(14,2) not null default 0,
  actual_card numeric(14,2) not null default 0,
  card_variance numeric(14,2) not null default 0,

  expected_transfer numeric(14,2) not null default 0,
  actual_transfer numeric(14,2) not null default 0,
  transfer_variance numeric(14,2) not null default 0,

  overall_variance numeric(14,2) not null default 0,
  status text not null default 'pending' check (status in ('balanced','short','over','variance','pending')),
  notes text,
  reconciled_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reconciliation_valid_period check (period_end > period_start),
  constraint reconciliation_period_unique unique (period_start,period_end)
);
create index if not exists reconciliation_records_period_idx on public.reconciliation_records(period_start desc,period_end desc);
create index if not exists reconciliation_records_created_idx on public.reconciliation_records(created_at desc);

-- Server-calculated expected receipts for any requested period.
create or replace function public.get_reconciliation_summary(p_start timestamptz,p_end timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_kitchen_cash numeric(14,2):=0;
  v_ticket_cash numeric(14,2):=0;
  v_gate_cash numeric(14,2):=0;
  v_card numeric(14,2):=0;
  v_transfer numeric(14,2):=0;
  v_gross_cash numeric(14,2):=0;
  v_change numeric(14,2):=0;
  v_cash_expenses numeric(14,2):=0;
  v_net_cash numeric(14,2):=0;
  v_expected_cash numeric(14,2):=0;
  v_transactions bigint:=0;
begin
  if auth.uid() is null or not (public.user_has_permission('reconcile_finance') or public.user_has_permission('admin_dashboard')) then
    raise exception 'Reconciliation permission required';
  end if;
  if p_start is null or p_end is null or p_end<=p_start then raise exception 'Invalid reconciliation period'; end if;

  select
    coalesce(sum(s.total_amount) filter(where s.sale_type='kitchen' and s.payment_mode='cash'),0),
    coalesce(sum(s.total_amount) filter(where s.sale_type='ticket' and s.payment_mode='cash'),0),
    coalesce(sum(s.total_amount) filter(where s.payment_mode='card'),0),
    coalesce(sum(s.total_amount) filter(where s.payment_mode='transfer'),0),
    coalesce(sum(coalesce(s.cash_received,s.total_amount)) filter(where s.payment_mode='cash'),0),
    coalesce(sum(coalesce(s.change_given,0)) filter(where s.payment_mode='cash'),0),
    count(*)
  into v_kitchen_cash,v_ticket_cash,v_card,v_transfer,v_gross_cash,v_change,v_transactions
  from public.sales s
  where coalesce(s.sale_date,s.created_at)>=p_start and coalesce(s.sale_date,s.created_at)<p_end;

  select
    coalesce(sum(g.amount) filter(where g.payment_mode='cash'),0),
    v_card + coalesce(sum(g.amount) filter(where g.payment_mode='card'),0),
    v_transfer + coalesce(sum(g.amount) filter(where g.payment_mode='transfer'),0),
    v_gross_cash + coalesce(sum(coalesce(g.cash_received,g.amount)) filter(where g.payment_mode='cash'),0),
    v_change + coalesce(sum(coalesce(g.change_given,0)) filter(where g.payment_mode='cash'),0),
    v_transactions + count(*)
  into v_gate_cash,v_card,v_transfer,v_gross_cash,v_change,v_transactions
  from public.gate_fee_records g
  where g.entry_at>=p_start and g.entry_at<p_end;

  select coalesce(sum(e.amount),0) into v_cash_expenses
  from public.expenses e
  where e.payment_mode='cash' and e.expense_date>=p_start and e.expense_date<p_end;

  -- This should equal kitchen cash + ticket cash + gate cash. Keeping the tender/change formula visible makes cash handling auditable.
  v_net_cash := v_gross_cash-v_change;
  v_expected_cash := v_net_cash-v_cash_expenses;

  return jsonb_build_object(
    'period_start',p_start,'period_end',p_end,
    'kitchen_cash',v_kitchen_cash,
    'ticket_cash',v_ticket_cash,
    'gate_cash',v_gate_cash,
    'gross_cash_received',v_gross_cash,
    'customer_change_given',v_change,
    'net_cash_sales',v_net_cash,
    'cash_expenses',v_cash_expenses,
    'expected_cash',v_expected_cash,
    'expected_card',v_card,
    'expected_transfer',v_transfer,
    'expected_total',v_expected_cash+v_card+v_transfer,
    'transactions',v_transactions
  );
end;
$$;
grant execute on function public.get_reconciliation_summary(timestamptz,timestamptz) to authenticated;

-- Save or update the reconciliation for an exact period. Expected values are always recalculated server-side.
create or replace function public.save_reconciliation(
  p_period_type text,
  p_start timestamptz,
  p_end timestamptz,
  p_actual_cash numeric,
  p_actual_card numeric,
  p_actual_transfer numeric,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_summary jsonb;
  v_expected_cash numeric(14,2);
  v_expected_card numeric(14,2);
  v_expected_transfer numeric(14,2);
  v_cash_variance numeric(14,2);
  v_card_variance numeric(14,2);
  v_transfer_variance numeric(14,2);
  v_overall numeric(14,2);
  v_status text;
  v_id bigint;
  v_ref text;
begin
  if auth.uid() is null or not (public.user_has_permission('reconcile_finance') or public.user_has_permission('admin_dashboard')) then
    raise exception 'Reconciliation permission required';
  end if;
  if p_period_type not in ('daily','weekly','custom') then raise exception 'Invalid period type'; end if;
  if p_actual_cash<0 or p_actual_card<0 or p_actual_transfer<0 then raise exception 'Actual amounts cannot be negative'; end if;

  v_summary := public.get_reconciliation_summary(p_start,p_end);
  v_expected_cash := coalesce((v_summary->>'expected_cash')::numeric,0);
  v_expected_card := coalesce((v_summary->>'expected_card')::numeric,0);
  v_expected_transfer := coalesce((v_summary->>'expected_transfer')::numeric,0);
  v_cash_variance := coalesce(p_actual_cash,0)-v_expected_cash;
  v_card_variance := coalesce(p_actual_card,0)-v_expected_card;
  v_transfer_variance := coalesce(p_actual_transfer,0)-v_expected_transfer;
  v_overall := v_cash_variance+v_card_variance+v_transfer_variance;

  if abs(v_cash_variance)<0.01 and abs(v_card_variance)<0.01 and abs(v_transfer_variance)<0.01 then
    v_status:='balanced';
  elsif (v_cash_variance< -0.01 or v_card_variance< -0.01 or v_transfer_variance< -0.01)
    and (v_cash_variance>0.01 or v_card_variance>0.01 or v_transfer_variance>0.01) then
    v_status:='variance';
  elsif v_cash_variance< -0.01 or v_card_variance< -0.01 or v_transfer_variance< -0.01 then
    v_status:='short';
  else
    v_status:='over';
  end if;

  insert into public.reconciliation_records(
    period_type,period_start,period_end,
    gross_cash_received,customer_change_given,net_cash_sales,cash_expenses,expected_cash,actual_cash,cash_variance,
    expected_card,actual_card,card_variance,expected_transfer,actual_transfer,transfer_variance,
    overall_variance,status,notes,reconciled_by,updated_at
  ) values (
    p_period_type,p_start,p_end,
    coalesce((v_summary->>'gross_cash_received')::numeric,0),coalesce((v_summary->>'customer_change_given')::numeric,0),
    coalesce((v_summary->>'net_cash_sales')::numeric,0),coalesce((v_summary->>'cash_expenses')::numeric,0),v_expected_cash,p_actual_cash,v_cash_variance,
    v_expected_card,p_actual_card,v_card_variance,v_expected_transfer,p_actual_transfer,v_transfer_variance,
    v_overall,v_status,nullif(trim(coalesce(p_notes,'')),''),auth.uid(),now()
  )
  on conflict(period_start,period_end) do update set
    period_type=excluded.period_type,
    gross_cash_received=excluded.gross_cash_received,
    customer_change_given=excluded.customer_change_given,
    net_cash_sales=excluded.net_cash_sales,
    cash_expenses=excluded.cash_expenses,
    expected_cash=excluded.expected_cash,
    actual_cash=excluded.actual_cash,
    cash_variance=excluded.cash_variance,
    expected_card=excluded.expected_card,
    actual_card=excluded.actual_card,
    card_variance=excluded.card_variance,
    expected_transfer=excluded.expected_transfer,
    actual_transfer=excluded.actual_transfer,
    transfer_variance=excluded.transfer_variance,
    overall_variance=excluded.overall_variance,
    status=excluded.status,
    notes=excluded.notes,
    reconciled_by=auth.uid(),
    updated_at=now()
  returning id,reconciliation_reference into v_id,v_ref;

  return jsonb_build_object('id',v_id,'reference',v_ref,'status',v_status,'overall_variance',v_overall,
    'cash_variance',v_cash_variance,'card_variance',v_card_variance,'transfer_variance',v_transfer_variance);
end;
$$;
grant execute on function public.save_reconciliation(text,timestamptz,timestamptz,numeric,numeric,numeric,text) to authenticated;

alter table public.reconciliation_records enable row level security;
drop policy if exists sel_reconciliation_read on public.reconciliation_records;
create policy sel_reconciliation_read on public.reconciliation_records for select to authenticated
using (public.user_has_permission('reconcile_finance') or public.user_has_permission('admin_dashboard'));

grant select on public.reconciliation_records to authenticated;
grant usage,select on sequence public.reconciliation_records_id_seq to authenticated;

-- Reconciliation users need read access to transaction/expense rows used by the page and its audit breakdown.
drop policy if exists sel_sales_select on public.sales;
create policy sel_sales_select on public.sales for select to authenticated
using (sold_by=auth.uid() or public.user_has_permission('view_ticket_reports') or public.user_has_permission('view_kitchen_reports') or public.user_has_permission('reconcile_finance') or public.user_has_permission('admin_dashboard'));

drop policy if exists sel_gate_select on public.gate_fee_records;
create policy sel_gate_select on public.gate_fee_records for select to authenticated
using (public.user_has_permission('gate_entry') or public.user_has_permission('view_gate_reports') or public.user_has_permission('reconcile_finance') or public.user_has_permission('admin_dashboard'));

drop policy if exists sel_expenses_admin on public.expenses;
create policy sel_expenses_admin on public.expenses for all to authenticated
using (public.user_has_permission('admin_dashboard'))
with check (public.user_has_permission('admin_dashboard'));

drop policy if exists sel_expenses_reconciliation_read on public.expenses;
create policy sel_expenses_reconciliation_read on public.expenses for select to authenticated
using (public.user_has_permission('reconcile_finance') or public.user_has_permission('admin_dashboard'));
