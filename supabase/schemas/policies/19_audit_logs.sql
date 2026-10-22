ALTER TABLE public.audit_logs
ENABLE ROW LEVEL SECURITY;

-- Helpers wrapped in (select ...) so they run once per statement, not per row.
CREATE POLICY "audit_logs_select"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (SELECT public.current_tenant_role()) IN (
        'tenant_admin',
        'manager'
    )
    -- Audit logs are a Business feature (plans.features_json.audit_logs).
    -- Rows are written on every plan; only reading is gated.
    AND (SELECT public.current_tenant_has_feature('audit_logs'))
);

-- A user's own notification-preference changes ("Settings history"), on any
-- role and plan.
CREATE POLICY "audit_logs_select_own_prefs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
    actor_id = (SELECT auth.uid())
    AND entity = 'notification_prefs'
    AND tenant_id = (SELECT public.current_tenant_id())
);

-- Direct inserts are limited to staff and to the events the app writes with
-- the user's own client (auth.service.ts login/logout, notifications.service.ts
-- preference history, audit.service.ts export). Everything else goes through
-- SECURITY DEFINER audit_record() or the admin client. WITH CHECK runs after
-- the audit_logs_fill trigger, so module and result are the filled values.
CREATE POLICY "audit_logs_insert"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (
    actor_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
    AND result = 'success'
    AND (
        (
            (SELECT public.current_tenant_role()) <> 'customer'
            AND entity_id = actor_id
            AND NOT (meta_json ? 'summary')
            AND (action::text, entity) IN (
                ('login', 'user'),
                ('logout', 'user'),
                ('update', 'notification_prefs')
            )
        )
        OR (
            (SELECT public.current_tenant_role()) IN ('tenant_admin', 'manager')
            AND action::text = 'export'
            AND entity = 'audit_log'
        )
    )
);
