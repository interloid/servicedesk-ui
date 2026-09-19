BEGIN;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    claims jsonb;
    v_tenant_id uuid;
    v_tenant_role text;
BEGIN
    claims := COALESCE(event->'claims', '{}'::jsonb);

    SELECT
        m.tenant_id,
        m.role::text
    INTO
        v_tenant_id,
        v_tenant_role
    FROM public.memberships m
    WHERE m.user_id = (event->>'user_id')::uuid
      AND m.status <> 'disabled'
    ORDER BY
        CASE
            WHEN m.status = 'active' THEN 0
            ELSE 1
        END,
        m.created_at
    LIMIT 1;

    IF v_tenant_id IS NOT NULL THEN
        claims := jsonb_set(
            claims,
            '{tenant_id}',
            to_jsonb(v_tenant_id),
            true
        );
    END IF;

    IF v_tenant_role IS NOT NULL THEN
        claims := jsonb_set(
            claims,
            '{tenant_role}',
            to_jsonb(v_tenant_role),
            true
        );
    END IF;

    event := jsonb_set(
        event,
        '{claims}',
        claims,
        true
    );

    RETURN event;
END;
$function$;

COMMIT;