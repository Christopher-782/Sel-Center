-- Apply ONLY AFTER retiring legacy direct-write code paths (see README).
-- The supported POS and Sales Dashboard use SECURITY DEFINER RPCs.
-- This removes the ability to forge sales and line items via PostgREST.
BEGIN;
REVOKE INSERT,UPDATE,DELETE ON public.sales,public.sale_items FROM PUBLIC, anon, authenticated;
-- New insert/updates/deletes still happen inside transaction-safe RPCs.
COMMIT;
