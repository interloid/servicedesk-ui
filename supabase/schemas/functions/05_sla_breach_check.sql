CREATE OR REPLACE FUNCTION public.process_sla_breaches()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated integer;
BEGIN
    UPDATE public.sla_events
    SET
        status = 'breached',
        breached_at = now()
    WHERE
        status = 'pending'
        AND due_at <= now();

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    RETURN v_updated;
END;
$$;