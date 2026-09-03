-- SEL Center Gate Entry admin CRUD upgrade
-- Adds admin-only update/delete access for gate entry records.
-- Safe to run after migrations 001-007. Does not delete existing data.

begin;

alter table public.gate_fee_records
  add column if not exists updated_at timestamptz not null default now();

alter table public.gate_fee_records
  add column if not exists updated_by uuid references auth.users(id);

-- Admins can update and delete gate-entry records. Normal gate staff retain
-- their existing insert/select permissions and cannot edit/delete records.
drop policy if exists sel_gate_admin_update on public.gate_fee_records;
create policy sel_gate_admin_update
on public.gate_fee_records
for update
to authenticated
using (public.user_has_permission('admin_dashboard'))
with check (public.user_has_permission('admin_dashboard'));

drop policy if exists sel_gate_admin_delete on public.gate_fee_records;
create policy sel_gate_admin_delete
on public.gate_fee_records
for delete
to authenticated
using (public.user_has_permission('admin_dashboard'));

grant select, insert, update, delete on public.gate_fee_records to authenticated;
grant usage, select on sequence public.gate_fee_records_id_seq to authenticated;

notify pgrst, 'reload schema';

commit;
