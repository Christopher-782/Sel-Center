INSERT INTO public.permissions(permission_key, label)
VALUES
('view_profit_reports', 'View Gross Profit and Net Profit Reports'),
('manage_expenses', 'Create and Manage Expenses'),
('edit_sales', 'Edit Sales Transactions'),
('reduce_stock', 'Reduce Inventory Stock'),
('view_stock_history', 'View Inventory Stock History')
ON CONFLICT (permission_key) DO NOTHING;