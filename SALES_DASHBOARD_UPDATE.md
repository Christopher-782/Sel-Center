# SEL Center — Staff Sales Dashboard matches Admin Sales Management

This update changes ONLY the staff-facing Sales Dashboard (`sales-dashboard.html` and `js/sales-dashboard.js`). It reuses the visual structure of the **Sales Management** section inside `operations-admin.html` while retaining Supabase granular permission checks.

## Features

- Same Sales Management section with loaded-record status and six summary figures: Total Sales, Cash, Card/POS, Transfer, Transactions, Average Sale.
- Search by sale reference, item, seller (where allowed by profiles RLS), type or payment.
- Filter Kitchen / Ticket, payment type, Today / Week / Month / Custom dates or All dates.
- Paged complete sales register with 25 / 50 / 100 / 250 / All rows and Sold By field.
- PDF / Excel export of **all matching rows**, not just the displayed table page.
- Create / edit / delete buttons appear only for users with their respective permissions; protected database functions `sales_catalog`, `sales_save_sale`, `sales_delete_sale` perform stock-sensitive changes.

## Deploy — no new SQL required

You have already applied migration 012. Do not run it again just for this UI update.

Back up your hosted files, then replace only these **two files** in your website's deployed root:

1. `sales-dashboard.html`
2. `js/sales-dashboard.js`

These can be taken from `frontend/dist/` inside the full project ZIP, or from the small two-file ZIP. Keep existing `css/operations.css`, `js/access-control.js`, and `js/supabaseClient.js` from the corrected merged project. Deploy to staging first. Clear the browser cache / hard refresh, then open `/sales-dashboard.html`.

If you deploy the **whole project**, the deployable directory is `frontend/dist`.

## Permissions — critical

To see any sales figures and records the user needs BOTH:
- `sales.dashboard.view`
- `sales.read`

To create, edit, delete respectively:
- `sales.create`
- `sales.update` (requires read to show an existing sale in the UI)
- `sales.delete` (requires read to show an existing sale in the UI)

Grant from the Admin Dashboard → Users & Access → Manage Access, or from Default Sales Access by Role. Changes may require refreshing the logged-in staff browser. **No user is made an admin.**

## Limitations and safety

- `Sold By` may display `User` if existing `profiles` RLS prevents a staff account from viewing other staff names. This update does not widen access to profile data.
- No cost/COGS/profit columns are requested by this frontend. Your existing Supabase table-level permissions may still expose confidential `unit_cost` and `cost_price` to direct API callers. Review database-layer column protection *before granting `sales.read` to staff who should not see costs*.
- On large databases, loading/exporting the entire matching register takes time and may hit your Supabase API response/performance limits. A future server-side report RPC with pagination is advisable for very large deployments.
- Do not run migration `013_sales_harden_direct_writes.sql` until the legacy POS paths have been converted and integration-tested.
- This update was checked using Node syntax and mocked permission/data tests; live Supabase and hosted browser end-to-end tests have NOT been performed.
