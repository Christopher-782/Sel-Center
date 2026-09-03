-- SEL Center - Reconciliation section filtering
-- Run after 001_operations_upgrade.sql, 002_admin_finance_upgrade.sql and 003_reconciliation_upgrade.sql.

-- Tag expenses to the operational section they belong to. Existing expenses remain General.
alter table public.expenses add column if not exists section text not null default 'general';

alter table public.expenses drop constraint if exists expenses_section_check;
alter table public.expenses add constraint expenses_section_check
  check (section in ('general','kitchen','ticket','gate'));

create index if not exists expenses_section_idx on public.expenses(section);

-- Section-aware server-calculated reconciliation.
create or replace function public.get_reconciliation_summary(
  p_start timestamptz,
  p_end timestamptz,
  p_section text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_section text := lower(coalesce(nullif(trim(p_section),''),'all'));
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
  if p_start is null or p_end is null or p_end<=p_start then
    raise exception 'Invalid reconciliation period';
  end if;
  if v_section not in ('all','kitchen','ticket','gate') then
    raise exception 'Invalid reconciliation section';
  end if;

  -- Kitchen/Ticket sales. Gate entries are stored separately.
  if v_section in ('all','kitchen','ticket') then
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
    where coalesce(s.sale_date,s.created_at)>=p_start
      and coalesce(s.sale_date,s.created_at)<p_end
      and (v_section='all' or s.sale_type=v_section);
  end if;

  -- Gate entries only contribute when All Sections or Gate Entry is selected.
  if v_section in ('all','gate') then
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
  end if;

  -- General expenses affect the all-sections view only. Section-specific views
  -- deduct only expenses explicitly tagged to that section.
  select coalesce(sum(e.amount),0) into v_cash_expenses
  from public.expenses e
  where e.payment_mode='cash'
    and e.expense_date>=p_start and e.expense_date<p_end
    and (
      v_section='all'
      or e.section=v_section
    );

  v_net_cash := v_gross_cash-v_change;
  v_expected_cash := v_net_cash-v_cash_expenses;

  return jsonb_build_object(
    'period_start',p_start,'period_end',p_end,'section',v_section,
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

grant execute on function public.get_reconciliation_summary(timestamptz,timestamptz,text) to authenticated;

-- Keep the existing two-argument API working for older code and saved reconciliation routines.
create or replace function public.get_reconciliation_summary(p_start timestamptz,p_end timestamptz)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select public.get_reconciliation_summary(p_start,p_end,'all');
$$;

grant execute on function public.get_reconciliation_summary(timestamptz,timestamptz) to authenticated;
