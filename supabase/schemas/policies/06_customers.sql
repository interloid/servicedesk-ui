-- ==========================================================
-- Customers RLS Policies
-- ==========================================================

ALTER TABLE public.customers
ENABLE ROW LEVEL SECURITY;

------------------------------------------------------------
-- SELECT
------------------------------------------------------------

CREATE POLICY "customers_select"
ON public.customers
FOR SELECT
TO authenticated
USING (
    (
        tenant_id = public.current_tenant_id()
        AND public.current_tenant_role() IN (
            'tenant_admin',
            'manager',
            'agent'
        )
    )
    OR
    (
        portal_user_id = auth.uid()
    )
);

------------------------------------------------------------
-- INSERT
------------------------------------------------------------

CREATE POLICY "customers_insert"
ON public.customers
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager'
    )
);

------------------------------------------------------------
-- UPDATE
------------------------------------------------------------

CREATE POLICY "customers_update"
ON public.customers
FOR UPDATE
TO authenticated
USING (
    (
        tenant_id = public.current_tenant_id()
        AND public.current_tenant_role() IN (
            'tenant_admin',
            'manager'
        )
    )
    OR
    (
        portal_user_id = auth.uid()
    )
)
WITH CHECK (
    (
        tenant_id = public.current_tenant_id()
        AND public.current_tenant_role() IN (
            'tenant_admin',
            'manager'
        )
    )
    OR
    (
        portal_user_id = auth.uid()
    )
);

------------------------------------------------------------
-- DELETE
------------------------------------------------------------

CREATE POLICY "customers_delete"
ON public.customers
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() = 'tenant_admin'
);