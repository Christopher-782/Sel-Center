# SEL Center Operations + Admin Finance Upgrade

This build includes the original operations upgrade plus the new professional admin/finance system.

## Included modules

- Gate Entry fee recording
- Kitchen POS: Drinks, Meals and Desserts
- Ticket POS: Kids and Adult ticket types
- Permission-controlled staff access
- Admin-only professional sidebar dashboard
- Full Sales CRUD with automatic stock reconciliation
- Full Ticket CRUD
- Kitchen Inventory CRUD/search
- Expense CRUD
- Gross Profit and Net Profit reporting
- Kitchen and Ticket audit logs
- User creation and access assignment
- Daily, weekly and custom-range reconciliation
- Cash tender/change capture for Kitchen POS, Ticket POS and Gate Entry

## Database setup

### If you already ran `001_operations_upgrade.sql`

Do **not** run it again. Run only:

`database/002_admin_finance_upgrade.sql`

in **Supabase Dashboard → SQL Editor → New Query**.

The second migration adds:

- `sale_items.unit_cost` for historical cost snapshots
- `ticket_packages.cost_price`
- `expenses`
- `ticket_audit_log`
- admin-safe sale update/delete RPC functions
- financial summary RPC
- updated POS sale logic that stores cost at the time of sale
- strict admin-only handling for the Admin Dashboard permission

### Fresh installation

Run the SQL files in this order:

1. `database/001_operations_upgrade.sql`
2. `database/002_admin_finance_upgrade.sql`

## Profit calculations

The dashboard uses these formulas:

**Total Revenue = Kitchen Sales + Ticket Sales + Gate Entry Revenue**

**Gross Profit = Total Revenue - Cost of Goods Sold (COGS)**

**Net Profit = Gross Profit - Operating Expenses**

Kitchen and Ticket sale items store their `unit_cost` when each sale is completed. This means changing a product cost later does not rewrite the cost of new sales going forward.

> Existing sales created before migration 002 have `unit_cost = 0` unless they are recreated/corrected. If you already cleared old operational data as planned, this does not affect the new records you create after the migration.

## Admin Dashboard

The new `operations-admin.html` is role-admin only. Non-admin per-user permission overrides cannot grant `admin_dashboard`.

Sidebar sections:

- Dashboard
- Sales
- Tickets
- Expenses
- Profit & Reports
- Kitchen Inventory
- Audit Logs
- Users & Access

### Sales CRUD behavior

Admins can:

- Create Kitchen or Ticket sales
- Read/search all sales
- Edit sale type, payment, date and items
- Delete sales

When an admin edits a sale, the database first restores the old item quantities and then deducts the replacement quantities. When a sale is deleted, its quantities are returned to stock.

### Ticket CRUD

Admins can create, edit and delete ticket types and manage:

- Audience/group
- Ticket type
- Selling price
- Cost price
- Quantity
- Low-stock threshold
- Active/inactive status
- Description

### Expenses

Admins can create, read, edit and delete operating expenses with:

- Category
- Description
- Amount
- Payment method
- Date/time
- Notes

Expenses are included automatically in Net Profit.

## User creation Edge Function

User creation still uses:

`supabase/functions/admin-create-user/index.ts`

If you already deployed `admin-create-user`, no new Edge Function deployment is required for this upgrade.

If it has not been deployed, use **Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor** and deploy it as:

`admin-create-user`

## Frontend deployment

Deploy the contents of the `frontend/dist` folder after running the new SQL migration.

The staff Operations Portal (`app.html`) now uses a sidebar instead of module cards. The **Admin Dashboard** sidebar item is only shown to administrators.

## Reconciliation upgrade (migration 003)

After migrations 001 and 002, run:

`database/003_reconciliation_upgrade.sql`

This adds a dedicated **Reconciliation** module with its own `reconcile_finance` permission. Admin users automatically have the permission, and an admin can grant it to an accountant from **Users & Access** without granting the Admin Dashboard.

Supported reconciliation periods:

- Daily
- Weekly (Monday through Sunday)
- Custom date range

The reconciliation page is now **fully system-calculated**. The accountant does not enter actual Cash, Card/POS or Transfer amounts. As soon as a Daily, Weekly or Custom Range is selected, the page automatically shows the expected totals recorded by the system for:

- Cash
- Card / POS
- Bank transfer

Changing the date/range automatically refreshes the figures. A **Refresh Totals** button is also available when new transactions have just been posted.

### Customer cash change

Cash transactions now store both `cash_received` and `change_given`. The Kitchen POS, Ticket POS and Gate Entry screen prompt for/record tendered cash when the payment method is Cash.

The cash reconciliation formula is:

**Gross cash received - Customer change returned - Cash expenses = Expected cash in hand**

For example, if a sale is ₦4,500 and the customer gives ₦5,000, the system records ₦5,000 cash received and ₦500 change. The drawer is expected to increase by ₦4,500.

The page also displays the total expected receipts and a timestamp showing when the selected period was last calculated. The previous manual actual-amount, variance, status and save-history workflow is not used by the frontend.

### Deployment order for this build

If 001 and 002 are already installed, run only:

1. `database/003_reconciliation_upgrade.sql`
2. Deploy the rebuilt contents of `frontend/dist`

No Edge Function redeployment is required for the reconciliation feature.

## Reconciliation section filter upgrade
If you already ran migrations `001`, `002`, and `003`, run only:

`database/004_reconciliation_section_filter.sql`

The Reconciliation page can then be filtered by **All Sections, Kitchen, Tickets, or Gate Entry**. Expense records also gain a Section field (`General`, `Kitchen`, `Tickets`, `Gate Entry`) so section-specific cash reconciliation deducts only expenses assigned to that section.

## Site-wide readability and dynamic UI upgrade

This build adds a shared frontend layer to every HTML page using:

- `frontend/css/site-dynamic.css`
- `frontend/js/site-dynamic.js`

No new Supabase migration is required for this UI/UX upgrade.

### Readability improvements

- Larger and more legible base font sizing
- Stronger text contrast for muted/help text
- Larger form labels, fields and buttons
- More readable tables with sticky headers
- Improved sidebar and topbar typography
- Responsive sizing for tablet and mobile screens

### Dynamic functions

- Desktop sidebar collapse/expand with the preference remembered locally
- Mobile sidebar backdrop and Escape-to-close behavior
- Automatic active navigation highlighting
- Live date/time in application headers
- Online/offline status indicator
- Ctrl/Cmd + K Quick Find navigation palette
- `/` keyboard shortcut to jump to the first visible search field
- Click-to-sort data tables with ascending/descending indicators
- Live table record counts when rows are re-rendered
- Toast notifications that mirror application success/error/info alerts
- Accessible labels/tooltips for common icon-only buttons
- Page navigation progress feedback
- Automatic refresh of supported dashboard/reconciliation pages when returning after an extended inactive period
- Reduced-motion support for users who disable interface animation

### Deployment

If migrations `001`, `002`, `003`, and `004` have already been run, do **not** run another SQL migration for this upgrade. Deploy the rebuilt contents of `frontend/dist`.

## Inventory schema compatibility fix (migration 005)

If the Admin Dashboard shows an error such as:

`Could not find the 'description' column of 'inventory_items' in the schema cache`

it means `inventory_items` existed before migration 001 and therefore kept part of its older schema. Run only:

`database/005_inventory_schema_compatibility.sql`

in **Supabase Dashboard → SQL Editor**. The migration safely adds any inventory columns required by the current Kitchen Inventory form, preserves existing products, and requests an immediate PostgREST schema-cache refresh.

If migrations 001-004 are already installed, do not rerun them. No frontend or Edge Function redeployment is required solely for this database fix.



## Payment mode enum compatibility fix (006)
If selling returns `column "payment_mode" is of type payment_mode but expression is of type text`, your original `sales.payment_mode` column is an enum. Run `database/006_payment_mode_enum_compatibility.sql` after the earlier migrations. It preserves existing data and recreates the sale RPC functions with an explicit enum cast. No Edge Function redeployment is required.

## Receipt printing fix

The current build includes a receipt-only printing engine for Kitchen POS, Ticket POS, and Gate Entry.

- Fixes the previous print CSS issue where the receipt could be hidden by its parent container.
- Prints only the receipt rather than the full application page.
- Optimized for 80mm thermal receipt paper.
- Includes the SEL Center logo, receipt details, payment method, cash received/change, cashier name, and footer.
- No database migration or Edge Function redeployment is required for this printing fix.

## Migration 007 — Ticket & Gate Profit Rule
Tickets and Gate Entry do not use a cost price. Run `database/007_ticket_gate_profit_rule.sql` after migrations 001-006. Ticket cost remains as a compatibility column in PostgreSQL but is forced to zero and is hidden from the Admin UI. Only Kitchen sale items contribute to COGS; therefore Ticket and Gate selling revenue contributes fully to gross profit before expenses.

## Gate Entry Admin CRUD upgrade (migration 008)

The Admin Dashboard now includes a dedicated **Gate Entry** module with Daily, Weekly, Monthly and Custom Range reports, payment filtering, search, totals for revenue/transactions/visitors/Cash/Card/Transfer, and full Create/Edit/Delete controls.

If migrations 001-007 are already installed, run only:

`database/008_gate_entry_admin_crud.sql`

Then redeploy the contents of `frontend/dist`. No Edge Function redeployment is required.
