CREATE OR REPLACE FUNCTION public.current_customer_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT c.id
    FROM public.customers c
    WHERE c.portal_user_id = auth.uid()
    LIMIT 1;
$$;