-- SEL Center: Sales dashboard and granular Sales RBAC.
-- Prerequisite: migrations 001 through 011 applied in sequence.
-- Apply to a Supabase staging branch first. No new non-admin role is granted access by default.
BEGIN;

INSERT INTO public.permissions(permission_key, label) VALUES
 ('sales.dashboard.view','Open Sales Dashboard'),
 ('sales.create','Create manual Sales records'),
 ('sales.read','Read full Sales register'),
 ('sales.update','Correct Sales and reconcile inventory'),
 ('sales.delete','Delete Sales and restore inventory')
ON CONFLICT (permission_key) DO UPDATE SET label=EXCLUDED.label;

-- Existing administrators still have every permission. Reserve both the
-- admin_dashboard and manage_users privileges for actual administrator roles;
-- otherwise delegated user-permission editors can escalate their own access.
CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS TABLE(permission_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 WITH me AS (
   SELECT auth.uid() AS user_id,
     lower(coalesce((SELECT p.role FROM public.profiles p WHERE p.id=auth.uid()),'')) AS role
 ), base AS (
   SELECT rp.permission_key FROM public.role_permissions rp CROSS JOIN me
   WHERE lower(rp.role)=me.role
 ), effective AS (
   SELECT p.permission_key FROM public.permissions p CROSS JOIN me
   WHERE me.role IN ('admin','super_admin')
   UNION
   SELECT b.permission_key FROM base b CROSS JOIN me
   WHERE me.role NOT IN ('admin','super_admin')
     AND b.permission_key NOT IN ('admin_dashboard','manage_users')
     AND NOT EXISTS (
       SELECT 1 FROM public.user_permissions up
       WHERE up.user_id=me.user_id AND up.permission_key=b.permission_key AND up.granted=false
     )
   UNION
   SELECT up.permission_key FROM public.user_permissions up CROSS JOIN me
   WHERE me.role NOT IN ('admin','super_admin')
     AND up.user_id=me.user_id AND up.granted=true
     AND up.permission_key NOT IN ('admin_dashboard','manage_users')
 )
 SELECT e.permission_key FROM effective e ORDER BY e.permission_key;
$$;
REVOKE ALL ON FUNCTION public.get_my_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO authenticated;

-- Only real admins, not users who obtained manage_users as an override,
-- can modify Sales permission defaults and overrides.
CREATE OR REPLACE FUNCTION public.is_sales_access_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.profiles p
   WHERE p.id=auth.uid() AND lower(p.role) IN ('admin','super_admin')
 );
$$;
REVOKE ALL ON FUNCTION public.is_sales_access_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_sales_access_admin() TO authenticated;

DROP POLICY IF EXISTS sel_sales_role_insert ON public.role_permissions;
CREATE POLICY sel_sales_role_insert ON public.role_permissions FOR INSERT TO authenticated
WITH CHECK (public.is_sales_access_admin() AND lower(role) IN ('manager','sale_associate')
            AND permission_key LIKE 'sales.%');
DROP POLICY IF EXISTS sel_sales_role_delete ON public.role_permissions;
CREATE POLICY sel_sales_role_delete ON public.role_permissions FOR DELETE TO authenticated
USING (public.is_sales_access_admin() AND lower(role) IN ('manager','sale_associate')
       AND permission_key LIKE 'sales.%');
GRANT INSERT,DELETE ON public.role_permissions TO authenticated;

-- A RESTRICTIVE policy combines with prior permissive user_permissions policies;
-- it cannot accidentally broaden manage_users privileges.
DROP POLICY IF EXISTS sel_sales_override_insert_guard ON public.user_permissions;
CREATE POLICY sel_sales_override_insert_guard ON public.user_permissions AS RESTRICTIVE
FOR INSERT TO authenticated WITH CHECK (
  permission_key NOT LIKE 'sales.%' OR public.is_sales_access_admin());
DROP POLICY IF EXISTS sel_sales_override_update_guard ON public.user_permissions;
CREATE POLICY sel_sales_override_update_guard ON public.user_permissions AS RESTRICTIVE
FOR UPDATE TO authenticated USING (
  permission_key NOT LIKE 'sales.%' OR public.is_sales_access_admin())
WITH CHECK (permission_key NOT LIKE 'sales.%' OR public.is_sales_access_admin());
DROP POLICY IF EXISTS sel_sales_override_delete_guard ON public.user_permissions;
CREATE POLICY sel_sales_override_delete_guard ON public.user_permissions AS RESTRICTIVE
FOR DELETE TO authenticated USING (
  permission_key NOT LIKE 'sales.%' OR public.is_sales_access_admin());

-- Keep legacy reporting/POS reads working; add a dedicated all-sales read grant.
-- Existing policies must be REPLACED, not supplemented with more permissive ones,
-- because permissive RLS policies are OR-ed.
DROP POLICY IF EXISTS sel_sales_select ON public.sales;
CREATE POLICY sel_sales_select ON public.sales FOR SELECT TO authenticated USING (
 public.user_has_permission('sales.read')
 OR public.user_has_permission('admin_dashboard')
 OR public.user_has_permission('reconcile_finance')
 OR (sale_type='ticket' AND public.user_has_permission('view_ticket_reports'))
 OR (sale_type='kitchen' AND public.user_has_permission('view_kitchen_reports'))
 OR (sold_by=auth.uid() AND (
   (sale_type='kitchen' AND public.user_has_permission('kitchen_pos'))
   OR (sale_type='ticket' AND public.user_has_permission('ticket_pos'))
 ))
);
DROP POLICY IF EXISTS sel_sale_items_select ON public.sale_items;
CREATE POLICY sel_sale_items_select ON public.sale_items FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM public.sales s WHERE s.id=sale_items.sale_id)
);

-- Limited catalog RPC avoids granting Sales-only users access to cost_price columns.
-- Do not broaden inventory_items/ticket_packages SELECT policies for this purpose.
CREATE OR REPLACE FUNCTION public.sales_catalog()
RETURNS TABLE (product_id text, product_name text, unit_price numeric, available_stock integer, sale_type text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT (
   public.user_has_permission('sales.create') OR public.user_has_permission('sales.update')
 ) THEN
   RAISE EXCEPTION 'sales.create or sales.update required' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
   SELECT i.id::text, i.name, i.price, i.quantity, 'kitchen'::text
   FROM public.inventory_items i WHERE i.is_active = true
   UNION ALL
   SELECT t.id::text, t.package_name, t.price, t.quantity, 'ticket'::text
   FROM public.ticket_packages t WHERE t.is_active = true;
END;
$$;
REVOKE ALL ON FUNCTION public.sales_catalog() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_catalog() TO authenticated;

-- Transactional create/update RPC: products, prices, costs, stock, and totals
-- are recomputed on the server. Caller may supply only item IDs and quantities.
CREATE OR REPLACE FUNCTION public.sales_save_sale(
 p_sale_id bigint, p_sale_type text, p_payment_mode text,
 p_items jsonb, p_sale_date timestamptz DEFAULT now(),
 p_cash_received numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_sale_id bigint;
 v_ref text;
 v_item jsonb;
 v_id text;
 v_qty integer;
 v_name text;
 v_price numeric(12,2);
 v_cost numeric(12,2);
 v_total numeric(12,2):=0;
 v_updated integer;
 v_payment public.sales.payment_mode%TYPE;
 v_product_type text;
 old_item public.sale_items%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
 IF p_sale_id IS NULL AND NOT public.user_has_permission('sales.create') THEN
   RAISE EXCEPTION 'sales.create required' USING ERRCODE='42501'; END IF;
 IF p_sale_id IS NOT NULL AND NOT public.user_has_permission('sales.update') THEN
   RAISE EXCEPTION 'sales.update required' USING ERRCODE='42501'; END IF;
 IF p_sale_type NOT IN ('kitchen','ticket') OR p_payment_mode NOT IN ('cash','card','transfer') THEN
   RAISE EXCEPTION 'Invalid type or payment mode'; END IF;
 IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION '1 to 100 sale items required'; END IF;
 IF p_sale_date IS NULL THEN p_sale_date:=now(); END IF;
 v_payment := p_payment_mode; -- valid for text- and enum-backed payment_mode

 IF p_sale_id IS NULL THEN
   v_ref := (CASE WHEN p_sale_type='kitchen' THEN 'KIT-' ELSE 'TKT-' END)
            || replace(gen_random_uuid()::text,'-','');
   INSERT INTO public.sales(sale_reference,payment_mode,total_amount,sold_by,sale_type,sale_date,created_at)
   VALUES(v_ref,v_payment,0,auth.uid(),p_sale_type,p_sale_date,now()) RETURNING id INTO v_sale_id;
 ELSE
   SELECT s.id,s.sale_reference INTO v_sale_id,v_ref FROM public.sales s
    WHERE s.id=p_sale_id AND s.sale_type IN ('kitchen','ticket') FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
   FOR old_item IN SELECT * FROM public.sale_items WHERE sale_id=v_sale_id LOOP
     IF old_item.product_type='inventory_items' THEN
       UPDATE public.inventory_items SET quantity=quantity+old_item.quantity,updated_at=now()
        WHERE id::text=old_item.product_id;
     ELSIF old_item.product_type='ticket_packages' THEN
       UPDATE public.ticket_packages SET quantity=quantity+old_item.quantity,updated_at=now()
        WHERE id::text=old_item.product_id;
     ELSE
       RAISE EXCEPTION 'Unsupported historical sale item type';
     END IF;
     GET DIAGNOSTICS v_updated = ROW_COUNT;
     IF v_updated<>1 THEN RAISE EXCEPTION 'Cannot restore historical stock'; END IF;
   END LOOP;
   DELETE FROM public.sale_items WHERE sale_id=v_sale_id;
 END IF;

 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
   v_id := v_item->>'id';
   IF v_id IS NULL OR NOT (v_item ? 'quantity') OR (v_item->>'quantity') !~ '^[0-9]+$' THEN
     RAISE EXCEPTION 'Invalid sale item'; END IF;
   v_qty := (v_item->>'quantity')::integer;
   IF v_qty < 1 OR v_qty > 100000 THEN RAISE EXCEPTION 'Invalid item quantity'; END IF;
   IF p_sale_type='kitchen' THEN
     SELECT i.name,i.price,coalesce(i.cost_price,0) INTO v_name,v_price,v_cost
      FROM public.inventory_items i WHERE i.id::text=v_id AND i.is_active=true FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'Kitchen product unavailable'; END IF;
     UPDATE public.inventory_items SET quantity=quantity-v_qty,updated_at=now()
      WHERE id::text=v_id AND quantity>=v_qty;
     v_product_type := 'inventory_items';
   ELSE
     SELECT t.package_name,t.price,0::numeric INTO v_name,v_price,v_cost
      FROM public.ticket_packages t WHERE t.id::text=v_id AND t.is_active=true FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'Ticket unavailable'; END IF;
     UPDATE public.ticket_packages SET quantity=quantity-v_qty,updated_at=now()
      WHERE id::text=v_id AND quantity>=v_qty;
     v_product_type := 'ticket_packages';
   END IF;
   GET DIAGNOSTICS v_updated = ROW_COUNT;
   IF v_updated<>1 THEN RAISE EXCEPTION 'Insufficient stock for %',v_name; END IF;
   INSERT INTO public.sale_items(sale_id,product_type,product_id,item_name,quantity,unit_price,unit_cost,total_price)
   VALUES(v_sale_id,v_product_type,v_id,v_name,v_qty,v_price,v_cost,v_price*v_qty);
   v_total := v_total+v_price*v_qty;
 END LOOP;
 IF p_payment_mode='cash' AND coalesce(p_cash_received,v_total)<v_total THEN
   RAISE EXCEPTION 'Cash received is less than sale total'; END IF;
 UPDATE public.sales SET
   payment_mode=v_payment,total_amount=v_total,sale_type=p_sale_type,sale_date=p_sale_date,
   cash_received=(CASE WHEN p_payment_mode='cash' THEN coalesce(p_cash_received,v_total) ELSE NULL END),
   change_given=(CASE WHEN p_payment_mode='cash' THEN coalesce(p_cash_received,v_total)-v_total ELSE 0 END)
 WHERE id=v_sale_id;
 RETURN jsonb_build_object('sale_id',v_sale_id,'sale_reference',v_ref,'total_amount',v_total);
END;
$$;
REVOKE ALL ON FUNCTION public.sales_save_sale(bigint,text,text,jsonb,timestamptz,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_save_sale(bigint,text,text,jsonb,timestamptz,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.sales_delete_sale(p_sale_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_item public.sale_items%ROWTYPE;
        v_updated integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.user_has_permission('sales.delete') THEN
   RAISE EXCEPTION 'sales.delete required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.sales WHERE id=p_sale_id AND sale_type IN ('kitchen','ticket') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
 FOR v_item IN SELECT * FROM public.sale_items WHERE sale_id=p_sale_id LOOP
   IF v_item.product_type='inventory_items' THEN
     UPDATE public.inventory_items SET quantity=quantity+v_item.quantity,updated_at=now()
      WHERE id::text=v_item.product_id;
   ELSIF v_item.product_type='ticket_packages' THEN
     UPDATE public.ticket_packages SET quantity=quantity+v_item.quantity,updated_at=now()
      WHERE id::text=v_item.product_id;
   ELSE
     RAISE EXCEPTION 'Unsupported historical sale item type';
   END IF;
   GET DIAGNOSTICS v_updated = ROW_COUNT;
   IF v_updated<>1 THEN RAISE EXCEPTION 'Cannot restore historical stock'; END IF;
 END LOOP;
 DELETE FROM public.sales WHERE id=p_sale_id; -- sale_items cascade
END;
$$;
REVOKE ALL ON FUNCTION public.sales_delete_sale(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_delete_sale(bigint) TO authenticated;

-- Server-computed totals obey the caller's existing sales SELECT policy.
CREATE OR REPLACE FUNCTION public.sales_dashboard_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.user_has_permission('sales.read') THEN
   RAISE EXCEPTION 'sales.read required' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
   'transactions',count(*),
   'total',coalesce(sum(s.total_amount),0),
   'cash',coalesce(sum(s.total_amount) FILTER(WHERE s.payment_mode::text='cash'),0),
   'card',coalesce(sum(s.total_amount) FILTER(WHERE s.payment_mode::text IN ('card','pos')),0),
   'transfer',coalesce(sum(s.total_amount) FILTER(WHERE s.payment_mode::text='transfer'),0)
 ) INTO v_result FROM public.sales s;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.sales_dashboard_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_dashboard_summary() TO authenticated;

-- Record both parent sale changes and individual item mutations.
CREATE TABLE IF NOT EXISTS public.sales_audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 sale_id bigint,
 entity text NOT NULL CHECK (entity IN ('sales','sale_items')),
 action text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
 old_row jsonb,
 new_row jsonb,
 actor_id uuid,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_audit_log_sale_time_idx ON public.sales_audit_log(sale_id,occurred_at DESC);
ALTER TABLE public.sales_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sel_sales_audit_read ON public.sales_audit_log;
CREATE POLICY sel_sales_audit_read ON public.sales_audit_log FOR SELECT TO authenticated
USING (public.is_sales_access_admin());
REVOKE ALL ON public.sales_audit_log FROM anon, authenticated;
GRANT SELECT ON public.sales_audit_log TO authenticated;

CREATE OR REPLACE FUNCTION public.log_sales_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old jsonb; v_new jsonb; v_id bigint;
BEGIN
 IF TG_OP <> 'INSERT' THEN v_old:=to_jsonb(OLD); END IF;
 IF TG_OP <> 'DELETE' THEN v_new:=to_jsonb(NEW); END IF;
 IF TG_TABLE_NAME='sales' THEN
   v_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 ELSE
   v_id:=CASE WHEN TG_OP='DELETE' THEN OLD.sale_id ELSE NEW.sale_id END;
 END IF;
 INSERT INTO public.sales_audit_log(sale_id,entity,action,old_row,new_row,actor_id)
 VALUES(v_id,TG_TABLE_NAME,TG_OP,v_old,v_new,auth.uid());
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sales_audit ON public.sales;
CREATE TRIGGER trg_sales_audit AFTER INSERT OR UPDATE OR DELETE ON public.sales
 FOR EACH ROW EXECUTE FUNCTION public.log_sales_change();
DROP TRIGGER IF EXISTS trg_sale_items_audit ON public.sale_items;
CREATE TRIGGER trg_sale_items_audit AFTER INSERT OR UPDATE OR DELETE ON public.sale_items
 FOR EACH ROW EXECUTE FUNCTION public.log_sales_change();

COMMIT;
