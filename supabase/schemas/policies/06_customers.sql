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
--
-- Staff only. There is no customer branch, and that is a deliberate removal
-- rather than a missing one.
--
-- The branch this replaces was `OR (portal_user_id = auth.uid())`, with no
-- column limit -- which is not "may update my own profile" but "may update any
-- column of my own row". Two of those columns matter: `email`, so an attacker
-- could point their row at victim@corp.com and receive every guest request
-- raised from that address, plus the replies agents send into it; and
-- `tenant_id`, which would move the row out of the workspace entirely.
--
-- Nothing needs it. The portal writes a customer's own name and company
-- through the admin client (updatePortalProfile), portal_link_user writes the
-- claim and the sign-in bookkeeping, and agents write the rest -- all three
-- bypass RLS by design, because each of them decides for itself what a row may
-- change.
--
-- A column list would be a second copy of those rules, and a second copy is
-- what has to be kept in step.

CREATE POLICY "customers_update"
ON public.customers
FOR UPDATE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager'
    )
)
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager'
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