-- SEL Center role permission update
insert into public.permissions(permission_key, description)
values
('view_profit_reports','View gross profit and net profit reports'),
('manage_expenses','Record and manage operating expenses'),
('edit_sales','Edit sales records')
on conflict (permission_key) do nothing;

-- Existing admin role keeps operational access but not profit visibility.
-- Assign view_profit_reports only to super admin users.
