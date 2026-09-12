CREATE OR REPLACE FUNCTION public.generate_ticket_number(
    p_tenant_id UUID
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_number BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text));

    SELECT COALESCE(MAX(number), 0) + 1
    INTO v_number
    FROM public.tickets
    WHERE tenant_id = p_tenant_id;

    RETURN v_number;
END;
$$;