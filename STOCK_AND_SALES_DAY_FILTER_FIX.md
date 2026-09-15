# Stock reduction and sales day filter fix

## What changed

- The Kitchen Inventory **Reduce stock** action now follows the `reduce_stock` permission instead of relying on a fragile `localStorage.userRole === "super_admin"` check.
- The stock reducer validates the permission in the UI and again in the database RPC.
- A new `inventory_stock_reductions` ledger stores quantity before/after, quantity removed, reason, user, and timestamp.
- Super Admin is now treated as an all-permissions role by the database permission function, matching the frontend behavior.
- Sales Management now has a **Sales day** calendar filter and a **Clear day** action. Exact-day filtering includes legacy sales whose `sale_date` is null by falling back to `created_at`.

## Required database step

Run this migration in Supabase SQL Editor after migration 010:

`database/011_inventory_stock_reduction.sql`

Without that migration, the Reduce stock button may be visible to an authorized user but the database RPC will not exist.
