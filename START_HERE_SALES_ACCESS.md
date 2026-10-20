# SEL Center sales access — updated frontend

The staff-facing Sales Dashboard now matches the layout and reporting features of the Admin Dashboard → Sales Management page. See `SALES_DASHBOARD_UPDATE.md` for deploy steps and permission requirements.

**Already ran migration 012?** Do not rerun it. Deploy `frontend/dist` to staging, or replace only `sales-dashboard.html` and `js/sales-dashboard.js` from the small patch. Give test accounts BOTH `sales.dashboard.view` and `sales.read` for Sales metrics and rows to appear. Do not deploy `013` until legacy writers are addressed. Preserve backups and test carefully.

For original migration and RBAC details see `IMPLEMENTATION_GUIDE.md`.
