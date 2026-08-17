ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view tenant Attachments"
ON public.attachments
FOR SELECT
TO authenticated
USING (
    tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND public.is_active_membership()
);

-- INSERT
CREATE POLICY "Members can create tenant Attachments"
ON public.attachments
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND public.is_active_membership()
);

-- UPDATE
CREATE POLICY "Members can update tenant Attachments"
ON public.attachments
FOR UPDATE
TO authenticated
USING (
    tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND public.is_active_membership()
)
WITH CHECK (
    tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND public.is_active_membership()
);

-- DELETE
CREATE POLICY "Members can delete tenant Attachments"
ON public.attachments
FOR DELETE
TO authenticated
USING (
    tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND public.is_active_membership()
);