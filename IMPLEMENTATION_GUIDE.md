# SEL Center · Staff Sales Dashboard + CRUD RBAC

## Status and prerequisites

This is a **targeted implementation patch**, not a complete replacement for the 114 MB source ZIP. It has been statically checked and the included frontend permission tests pass, but **it has not been run against your live Supabase instance**. Deploy first on a Supabase staging branch. Make a verified database backup before applying SQL migrations.

The uploaded app runs **vanilla JavaScript + Supabase Auth + Postgres RLS**, not Express, Django, or Laravel. This patch uses the existing database authorization design rather than inserting a redundant API server. Prerequisite SQL migrations: `database/001_...` through `database/011_...`. Confirm the existing payment-mode column and functions are compatible with your live database, especially upgrades `006` and `007`.

## Patch contents

Copy into the original project **preserving paths**:

- `frontend/app.html` — separate Sales Dashboard link, hidden unless authorized.
- `frontend/sales-dashboard.html` — new staff-facing dashboard.
- `frontend/js/sales-dashboard.js` — list, summary, manual create/update/delete, and permission-gated controls.
- `frontend/js/access-control.js` — new permission labels and fail-closed permission loading; does not use stale `localStorage` for authorization.
- `frontend/operations-admin.html` — role Sales-permission editor in Users & Access.
- `frontend/js/operations-admin.js` — saves role defaults and supports user-level Sales permissions through the existing Manage Access screen.
- `database/012_sales_dashboard_rbac.sql` — permissions, safeguards, DB RPCs, SQL audit log and readable Sales RLS.
- `database/013_sales_harden_direct_writes.sql` — **mandatory final cutover** to block forged direct Sales writes, but only apply after legacy direct writers are retired.
- `tests/access-control.test.cjs` — basic JavaScript permission checks.

## Permissions

| Permission | Meaning | Checked at |
| --- | --- | --- |
| `sales.dashboard.view` | Open dedicated page | `ensureAuth()` on route, UI |
| `sales.read` | Read all sales and totals (single tenant) | Postgres RLS + invoker summary RPC |
| `sales.create` | Manually create sales | UI + transactional `sales_save_sale` RPC |
| `sales.update` | Edit sales with automatic stock correction | UI + same RPC |
| `sales.delete` | Delete and restock | UI + `sales_delete_sale` RPC |

Permissions are **independent**. Dashboard view alone does not imply register data access, and Read alone does not grant Update/Delete. The page can show the app shell without register data when only View is assigned.

### Recommended example matrix AFTER administrators assign access

| Role or staff group | Dashboard | Create | Read | Update | Delete | Admin dashboard |
| --- | --- | --- | --- | --- | --- | --- |
| Super Admin | Yes | Yes | Yes | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes | Yes | Yes | Yes |
| Manager | Yes | Yes | Yes | Yes | No | No |
| Sales Associate | Yes | No | Yes | No | No | No |
| Auditor (per-user assignment) | Yes | No | Yes | No | No | No |
| Unassigned staff | No | No | No | No | No | No |

**The SQL migration does not grant new Sales permissions to staff automatically.** Use the Admin Dashboard -> Users & Access -> **Default Sales Access by Role** to configure `manager` / `sale_associate`, and the existing **Manage Access** UI to override individuals. An auditor is an example of a user-specific permission set, **not** a new database role added by this patch.

### Role enforcement

The resolver uses role permissions plus user overrides and reserves `admin_dashboard` and `manage_users` for real admin/super admin profiles. This intentionally removes any previously delegated `manage_users` access from non-admins to close a privilege-escalation path. Super admins/admins continue to receive every permission.

## Database/schema impact

This patch **reuses**: `profiles.role`, `permissions`, `role_permissions`, `user_permissions`, `sales`, `sale_items`, `inventory_items`, `ticket_packages`.

New: 5 permission keys, one audit table (`sales_audit_log`) with indexes and a trigger on sales and sale_items; protected RPCs: `sales_catalog`, `sales_save_sale`, `sales_delete_sale`, `sales_dashboard_summary`, plus `is_sales_access_admin`.

- RLS for Sales Read is updated to include `sales.read` while retaining **POS-only own-sale access** and existing scoped report views (`view_ticket_reports`, `view_kitchen_reports`, and `reconcile_finance`). Therefore `sales.read` is the all-sales register permission but is not the only way legacy users can read scoped transactions. Sales items are accessible only when the parent sale is visible.
- Permission grants by role and by user are editable only via existing Admin UI; Sales role default inserts/deletes require actual admin role, and Sales-specific user override writes require actual admin role.
- Manual Sales writes are performed inside database transactions with server-calculated price/cost/total and atomic inventory stock updates.
- Sales history is stored as database-triggered BEFORE/AFTER JSON in `sales_audit_log`, including actor UUID and timestamp. The audit table is read-only to admin users.
- SQL `SECURITY DEFINER` functions use a fixed empty `search_path`; the new exposed functions have EXECUTE removed from `PUBLIC` and `anon` and check the logged-in caller explicitly.

### Sensitive cost columns: an important remaining design limitation

Existing `sale_items.unit_cost` and `inventory_items.cost_price` reside in API-exposed tables. Because Supabase's `authenticated` database role is shared by *all* signed-in users, ordinary RLS only restricts rows, **not individual sensitive fields**. A user who gets row-level access to `sale_items` may still query `unit_cost` directly through the Data API, even though the new page deliberately does not display it.

If per-sale COGS or margin figures must be confidential, **do not assign `sales.read` to that audience until cost data is moved to a separately protected table/schema (preferred) or the API is changed to use restricted projections plus column-level grants**. This should be part of production security review, especially if users must not access profit data.

### Multi-tenant limitation

The existing source contains **no tenant_id** on Sales or staff-role permission assignments. This patch deliberately treats SEL Center as a **single organization**. Do not use it for multiple isolated tenants as-is. For multi-tenant operation, add `tenants`, `tenant_memberships`, `tenant_id` on sales and sale items (or enforce via parent), and tenant-scoped `role_permissions`/overrides. Every `SECURITY DEFINER` mutation must check `tenant_id` against authenticated membership **inside the function**, not merely rely on RLS. Use indexes `(tenant_id, created_at DESC)`, `(tenant_id, sold_by)`, and tenant composite foreign keys where appropriate.

## Migration and deployment order

1. **Back up and clone staging**. Confirm all earlier SQL migration files through 011 have run. Test legacy POS and admin sales edits on staging before changes.
2. Run `database/012_sales_dashboard_rbac.sql` in Supabase SQL editor or SQL migration deployment. Grant **no staff permissions yet**.
3. Copy/merge the updated/new frontend files. Run the existing `frontend` build. Deploy as a single release so the new route and permissions are in place together.
4. Sign in as a real admin or super admin. Under **Users & Access**, grant one test manager `sales.dashboard.view` and `sales.read` through *Manage Access*. Confirm Sales Dashboard appears in Operations Portal and the Admin Dashboard does not appear for that manager.
5. Add `sales.create` to test manual sales and inventory; add `sales.update`/`sales.delete` to a test account one at a time; test rollback on insufficient stock and audit logging. Make sure stock totals match Sales.
6. **Legacy-write cutover:** inspect `frontend/pos.html`, `frontend/backuppos.html`, `frontend/admin.html`, and `frontend/adminbackup.html`. These have older direct database write paths in addition to the newer RPC POS flows. Port any still-used direct writes to `process_pos_sale_v2`/existing admin correction RPCs or the new `sales_save_sale` RPC as appropriate.
7. **Only after legacy write paths are retired**, apply `database/013_sales_harden_direct_writes.sql`. This revokes direct `INSERT`, `UPDATE`, and `DELETE` on the Sales aggregate from authenticated browser sessions. Function-based POS continues to work because protected database functions own their writes. Applying 013 too early **will break legacy POS/Admin pages**.
8. Gradually enable role defaults for Manager and Sales Associate. Monitor denied operations, discrepancies, errors, and `sales_audit_log`; add permissions only after review.

## Test matrix (must run against staging with real JWTs)

| Test | Expected |
| --- | --- |
| Unauthenticated opens `sales-dashboard.html` | Redirect to login; no Sales data |
| Signed-in staff has no View | Access denied, no records |
| Staff has View, not Read | Dashboard shell only; no register data |
| Staff has View + Read | Summary and register visible; no create/edit/delete buttons |
| Staff has Create only | Direct `sales_save_sale(null,...)` succeeds; Update/Delete RPC denied |
| Staff has Update but not Delete | Edit allowed; Delete RPC denied |
| Staff has Delete but not Update | Delete allowed; Edit RPC denied |
| Staff tampers with JS/localStorage | Does not add database permission |
| Staff calls `admin_delete_sale` | 42501 / denied unless real admin privileges |
| Staff calls direct `DELETE public.sales` after migration 013 | PostgREST permission denied |
| Staff passes fake price/cost in Sale item JSON | RPC uses catalog prices; client-supplied prices ignored |
| Staff tries insufficient stock or invalid type | Transaction rolls back; stock and sale rows unchanged |
| Sale corrected from 3 to 2 units | Stock adjusts by +1 net |
| Sale deleted | Stock restored; Sales, child records, and audit updated |
| Admin revokes permission during signed-in session | Subsequent RPC/SQL requests denied immediately; UI reflects on refresh |
| Staff tries to alter `role_permissions` | RLS rejects |
| Staff tries to grant their own Sales rights in `user_permissions` | RLS rejects |
| `manager` receives no `admin_dashboard` in resolver even if a forged override exists | Admin route denied |
| Two staff concurrently attempt last unit of stock | At most one succeeds |
| Reconciliation, Kitchen POS, Ticket POS and prior reports | Continue working using legacy authorized paths |
| Any confidential cost column | Verify API does not leak COGS before granting that role Read |
| Tenant A vs tenant B (future) | All queries and RPCs constrained to the appropriate tenant |

### Suggested automated tests

- Unit tests: permission resolution, server default deny, front-end button visibility, sale validation, transaction failure.
- Integration tests: create/edit/delete permission combinations using real JWT sessions, audit writes, atomic stock, RLS `SELECT` and `INSERT/UPDATE/DELETE` direct attempts, Postgres RPC direct calls.
- Acceptance tests: Manager view without admin UI; test grant/revoke via Admin UI; responsive desktop/mobile and exports as applicable.
- Run included quick checks using `node tests/access-control.test.cjs` and `node --check` for all modified JavaScript files. This test does **not** replace real Supabase integration testing.

## Performance and rollback

The dashboard fetches the last **100** sales for its table and runs a database aggregate for full totals. Avoid fetching every historical row in the browser for dashboards. The existing `sales(sale_type, created_at DESC)` index helps reports; consider a single `sales(created_at DESC)` index for the recent list and add more targeted index/summary rollups after profiling large datasets. Primary keys on `role_permissions` and `user_permissions` already support lookups.

To roll back the **frontend**, restore the original files from your source ZIP. Remove non-admin `sales.*` grants/overrides if reverting staff access. Keep audit logs for investigation. If 013 unexpectedly blocks a live legacy workflow, restore only the necessary database grants as a temporary emergency measure after evaluating fraud exposure, then complete the POS RPC migration. Avoid blindly deleting new permissions or the audit table while active sessions still depend on them.

## Optional Express middleware if a separate backend is introduced later

Your current application needs no Express layer. If a custom API is introduced, use the exact same permissions via JWT-verified server auth, then perform business operations with SQL transactions under appropriate database policies:

```js
app.delete('/api/sales/:id', authenticateJwt, async (req, res) => {
  // Never use role claims, cached localStorage values or permission arrays supplied by the browser.
  const permitted = await dbForUser(req.userToken).rpc('user_has_permission', {
    p_permission: 'sales.delete',
  });
  if (permitted.error || permitted.data !== true) return res.sendStatus(403);
  const result = await dbForUser(req.userToken).rpc('sales_delete_sale', {
    p_sale_id: Number(req.params.id),
  });
  if (result.error) return res.status(400).json({ error: 'Sale could not be deleted' });
  res.sendStatus(204);
});
```

The database function remains the enforcement boundary even when middleware is present.

## Remaining security review notes

- Review all older public HTML pages (`admin.html`, `adminbackup.html`, `pos.html`, `backuppos.html`): some do not use the new `SELAccess.ensureAuth()` routing. They should not be treated as private merely because their links are hidden. Protect the underlying data with RLS and deprecate unused pages.
- Existing Finance, Sales and inventory `SECURITY DEFINER` routines should each be checked for role checks, explicit `search_path`, EXECUTE privileges, and whether per-item prices/costs can be supplied from the client. The new Sales RPC recomputes these server-side.
- The latest original `get_my_permissions()` grants admin/super admin all privileges. This is retained but should be governed through administrator role assignment rather than per-user grants.
- Audit entries are triggered at the DB layer, not generated by JavaScript, to prevent bypass via a modified browser.
