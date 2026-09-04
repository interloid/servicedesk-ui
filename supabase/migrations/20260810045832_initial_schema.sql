-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE EXTENSION btree_gin WITH SCHEMA public;

CREATE EXTENSION citext WITH SCHEMA public;

CREATE EXTENSION pg_trgm WITH SCHEMA public;

CREATE TYPE public.audit_action AS ENUM (
  'create',
  'update',
  'delete',
  'login',
  'logout',
  'invite',
  'assign'
);

CREATE TYPE public.author_type AS ENUM (
  'agent',
  'customer',
  'system'
);

CREATE TYPE public.customer_status AS ENUM (
  'active',
  'blocked'
);

CREATE TYPE public.invoice_status AS ENUM (
  'pending',
  'paid',
  'failed',
  'refunded'
);

CREATE TYPE public.membership_role AS ENUM (
  'platform_admin',
  'tenant_admin',
  'manager',
  'agent',
  'billing_admin',
  'customer'
);

CREATE TYPE public.membership_status AS ENUM (
  'invited',
  'active',
  'disabled'
);

CREATE TYPE public.message_visibility AS ENUM (
  'public',
  'internal'
);

CREATE TYPE public.notification_type AS ENUM (
  'ticket_assigned',
  'ticket_created',
  'ticket_updated',
  'ticket_closed',
  'mention',
  'sla_breach',
  'billing',
  'system'
);

CREATE TYPE public.sla_event_status AS ENUM (
  'pending',
  'completed',
  'breached'
);

CREATE TYPE public.sla_event_type AS ENUM (
  'first_response',
  'resolution'
);

CREATE TYPE public.subscription_status AS ENUM (
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'expired'
);

CREATE TYPE public.tenant_status AS ENUM (
  'active',
  'suspended',
  'cancelled'
);

CREATE TYPE public.ticket_priority AS ENUM (
  'low',
  'normal',
  'high',
  'urgent'
);

CREATE TYPE public.ticket_status AS ENUM (
  'new',
  'open',
  'pending',
  'on_hold',
  'resolved',
  'closed'
);

CREATE FUNCTION public."current_role"()
  RETURNS text
  LANGUAGE sql
  STABLE
  AS $function$
SELECT auth.jwt()->>'tenant_role';
$function$;

CREATE FUNCTION public.current_customer_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
    SELECT c.id
    FROM public.customers c
    WHERE c.portal_user_id = auth.uid()
    LIMIT 1;
$function$;

CREATE FUNCTION public.current_tenant_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  AS $function$
SELECT (auth.jwt()->>'tenant_id')::uuid;
$function$;

CREATE FUNCTION public.custom_access_token_hook (
  event jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
    claims jsonb;
    v_tenant_id uuid;
    v_tenant_role text;
begin
    --------------------------------------------------------
    -- Existing JWT claims
    --------------------------------------------------------

    claims := event->'claims';

    --------------------------------------------------------
    -- Get user's active membership
    --------------------------------------------------------

    select
        m.tenant_id,
        m.role::text
    into
        v_tenant_id,
        v_tenant_role
    from public.memberships m
    where m.user_id = (event->>'user_id')::uuid
    limit 1;

    --------------------------------------------------------
    -- Add tenant_id claim
    --------------------------------------------------------

    claims := jsonb_set(
        claims,
        '{tenant_id}',
        to_jsonb(v_tenant_id),
        true
    );

    --------------------------------------------------------
    -- Add tenant_role claim
    --------------------------------------------------------

    claims := jsonb_set(
        claims,
        '{tenant_role}',
        to_jsonb(v_tenant_role),
        true
    );

    --------------------------------------------------------
    -- Update event claims
    --------------------------------------------------------

    event := jsonb_set(
        event,
        '{claims}',
        claims,
        true
    );

    return event;
end;
$function$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

CREATE FUNCTION public.generate_ticket_number (
  p_tenant_id uuid
)
  RETURNS bigint
  LANGUAGE plpgsql
  AS $function$
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
$function$;

CREATE FUNCTION public.is_active_membership()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.tenant_id = (auth.jwt()->>'tenant_id')::uuid
      AND m.role::text = auth.jwt()->>'tenant_role'
      AND m.status = 'active'
);
$function$;

CREATE FUNCTION public.process_sla_breaches()
  RETURNS integer
  LANGUAGE plpgsql
  AS $function$
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
$function$;

CREATE FUNCTION public.update_updated_at_column()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

CREATE TABLE public.attachments (
  id                uuid                     DEFAULT gen_random_uuid() NOT NULL,
  tenant_id         uuid                     NOT NULL,
  ticket_id         uuid                     NOT NULL,
  message_id        uuid,
  storage_path      text                     NOT NULL,
  filename          text                     NOT NULL,
  original_filename text                     NOT NULL,
  mime              text                     NOT NULL,
  extension         text,
  size              bigint                   NOT NULL,
  uploaded_by       uuid,
  checksum          text,
  created_at        timestamp with time zone DEFAULT now() NOT NULL,
  updated_at        timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.attachments IS 'Metadata for files stored in Supabase Storage';

COMMENT ON COLUMN public.attachments.storage_path IS 'Bucket path';

COMMENT ON COLUMN public.attachments.checksum IS 'SHA256 or MD5 checksum';

ALTER TABLE public.attachments
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.attachments
  ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);

ALTER TABLE public.attachments
  ADD CONSTRAINT chk_file_size CHECK (size >= 0);

ALTER TABLE public.attachments
  ADD CONSTRAINT uq_storage_path UNIQUE (storage_path);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.attachments TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.attachments TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.attachments TO service_role;

CREATE POLICY "Members can create tenant Attachments" ON public.attachments
  FOR INSERT
  TO authenticated
  WITH CHECK (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE POLICY "Members can delete tenant Attachments" ON public.attachments
  FOR DELETE
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE POLICY "Members can update tenant Attachments" ON public.attachments
  FOR UPDATE
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()))
  WITH CHECK (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE POLICY "Members can view tenant Attachments" ON public.attachments
  FOR SELECT
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE TABLE public.audit_logs (
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  tenant_id  uuid                     NOT NULL,
  actor_id   uuid,
  action     public.audit_action      NOT NULL,
  entity     text                     NOT NULL,
  entity_id  uuid,
  meta_json  jsonb                    DEFAULT '{}'::jsonb,
  ip         inet,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.audit_logs
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.audit_logs TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.audit_logs TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.audit_logs TO service_role;

CREATE INDEX idx_audit_entity ON public.audit_logs (entity, entity_id);

CREATE INDEX idx_audit_created ON public.audit_logs (created_at DESC);

CREATE INDEX idx_audit_actor ON public.audit_logs (actor_id);

CREATE INDEX idx_audit_tenant ON public.audit_logs (tenant_id);

CREATE INDEX idx_audit_action ON public.audit_logs (action);

CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))));

CREATE TABLE public.business_hours (
  id            uuid                     DEFAULT gen_random_uuid() NOT NULL,
  tenant_id     uuid                     NOT NULL,
  name          text                     NOT NULL,
  timezone_id   uuid                     NOT NULL,
  schedule_json jsonb                    NOT NULL,
  holidays_json jsonb                    DEFAULT '[]'::jsonb NOT NULL,
  created_at    timestamp with time zone DEFAULT now(),
  updated_at    timestamp with time zone DEFAULT now()
);

ALTER TABLE public.business_hours
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.business_hours
  ADD CONSTRAINT business_hours_pkey PRIMARY KEY (id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.business_hours TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.business_hours TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.business_hours TO service_role;

CREATE POLICY business_hours_delete ON public.business_hours
  FOR DELETE
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = 'tenant_admin'::text)));

CREATE POLICY business_hours_insert ON public.business_hours
  FOR INSERT
  TO authenticated
  WITH CHECK (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))));

CREATE POLICY business_hours_select ON public.business_hours
  FOR SELECT
  TO authenticated
  USING ((tenant_id = public.current_tenant_id()));

CREATE POLICY business_hours_update ON public.business_hours
  FOR UPDATE
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))))
  WITH CHECK (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))));

CREATE TABLE public.customers (
  id             uuid                     DEFAULT gen_random_uuid() NOT NULL,
  tenant_id      uuid                     NOT NULL,
  email          public.citext            NOT NULL,
  full_name      text                     NOT NULL,
  portal_user_id uuid,
  phone          text,
  created_at     timestamp with time zone DEFAULT now() NOT NULL,
  updated_at     timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.customers IS 'Customers belonging to a tenant';

ALTER TABLE public.customers
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_pkey PRIMARY KEY (id);

ALTER TABLE public.customers
  ADD CONSTRAINT customers_portal_user_id_fkey FOREIGN KEY (portal_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.customers
  ADD CONSTRAINT uq_customer_email UNIQUE (tenant_id, email);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.customers TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.customers TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.customers TO service_role;

CREATE INDEX idx_customer_tenant ON public.customers (tenant_id);

CREATE INDEX idx_customer_portal ON public.customers (portal_user_id);

CREATE INDEX idx_customer_email ON public.customers (email);

CREATE POLICY customers_delete ON public.customers
  FOR DELETE
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = 'tenant_admin'::text)));

CREATE POLICY customers_insert ON public.customers
  FOR INSERT
  TO authenticated
  WITH CHECK (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))));

CREATE POLICY customers_select ON public.customers
  FOR SELECT
  TO authenticated
  USING
    ((((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text, 'agent'::text]))) OR (portal_user_id =
    auth.uid())));

CREATE POLICY customers_update ON public.customers
  FOR UPDATE
  TO authenticated
  USING ((((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))) OR (portal_user_id = auth.uid())))
  WITH CHECK ((((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))) OR (portal_user_id = auth.uid())));

CREATE TABLE public.invoices (
  id            uuid                     DEFAULT gen_random_uuid() NOT NULL,
  tenant_id     uuid                     NOT NULL,
  paypal_txn_id text,
  amount        numeric(10,2)            NOT NULL,
  status        public.invoice_status    NOT NULL,
  storage_path  text,
  period_start  date                     NOT NULL,
  period_end    date                     NOT NULL,
  created_at    timestamp with time zone DEFAULT now(),
  updated_at    timestamp with time zone DEFAULT now()
);

ALTER TABLE public.invoices
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.invoices
  ADD CONSTRAINT chk_invoice_amount CHECK (amount >= 0::numeric);

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_paypal_txn_id_key UNIQUE (paypal_txn_id);

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.invoices TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.invoices TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.invoices TO service_role;

CREATE INDEX idx_invoice_tenant ON public.invoices (tenant_id);

CREATE INDEX idx_invoice_period ON public.invoices (period_start, period_end);

CREATE INDEX idx_invoice_status ON public.invoices (status);

CREATE POLICY invoices_delete ON public.invoices
  FOR DELETE
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND public.is_active_membership() AND (public."current_role"() = 'tenant_admin'::text)));

CREATE POLICY invoices_insert ON public.invoices
  FOR INSERT
  TO authenticated
  WITH CHECK (((tenant_id = public.current_tenant_id()) AND public.is_active_membership() AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'billing_admin'::text]))));

CREATE POLICY invoices_select ON public.invoices
  FOR SELECT
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND public.is_active_membership() AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'billing_admin'::text]))));

CREATE POLICY invoices_update ON public.invoices
  FOR UPDATE
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND public.is_active_membership() AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'billing_admin'::text]))))
  WITH CHECK (((tenant_id = public.current_tenant_id()) AND public.is_active_membership() AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'billing_admin'::text]))));

CREATE TABLE public.memberships (
  id          uuid                     DEFAULT gen_random_uuid() NOT NULL,
  tenant_id   uuid                     NOT NULL,
  user_id     uuid                     NOT NULL,
  role        public.membership_role   NOT NULL,
  status      public.membership_status DEFAULT 'invited'::public.membership_status NOT NULL,
  invited_by  uuid,
  joined_at   timestamp with time zone,
  disabled_at timestamp with time zone,
  created_at  timestamp with time zone DEFAULT now() NOT NULL,
  updated_at  timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.memberships
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);

ALTER TABLE public.memberships
  ADD CONSTRAINT uq_membership UNIQUE (tenant_id, user_id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.memberships TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.memberships TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.memberships TO service_role;

CREATE POLICY memberships_delete ON public.memberships
  FOR DELETE
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = 'tenant_admin'::text)));

CREATE POLICY memberships_insert ON public.memberships
  FOR INSERT
  TO authenticated
  WITH CHECK (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))));

CREATE POLICY memberships_select ON public.memberships
  FOR SELECT
  TO authenticated
  USING ((tenant_id = public.current_tenant_id()));

CREATE POLICY memberships_update ON public.memberships
  FOR UPDATE
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))))
  WITH CHECK (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = 'tenant_admin'::text)));

CREATE TABLE public.notification_prefs (
  id           uuid                     DEFAULT gen_random_uuid() NOT NULL,
  tenant_id    uuid                     NOT NULL,
  user_id      uuid                     NOT NULL,
  channel_json jsonb                    DEFAULT jsonb_build_object('email', true, 'in_app', true) NOT NULL,
  created_at   timestamp with time zone DEFAULT now(),
  updated_at   timestamp with time zone DEFAULT now()
);

ALTER TABLE public.notification_prefs
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notification_prefs
  ADD CONSTRAINT notification_prefs_pkey PRIMARY KEY (id);

ALTER TABLE public.notification_prefs
  ADD CONSTRAINT uq_notification_pref UNIQUE (tenant_id, user_id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.notification_prefs TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.notification_prefs TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.notification_prefs TO service_role;

CREATE POLICY "Members can create tenant Notification preference" ON public.notification_prefs
  FOR INSERT
  TO authenticated
  WITH CHECK (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE POLICY "Members can delete tenant Notification preference" ON public.notification_prefs
  FOR DELETE
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE POLICY "Members can update tenant Notification preference" ON public.notification_prefs
  FOR UPDATE
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()))
  WITH CHECK (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE POLICY "Members can view tenant Notification preference" ON public.notification_prefs
  FOR SELECT
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE TABLE public.notifications (
  id           uuid                     DEFAULT gen_random_uuid() NOT NULL,
  tenant_id    uuid                     NOT NULL,
  user_id      uuid                     NOT NULL,
  type         public.notification_type NOT NULL,
  payload_json jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  read_at      timestamp with time zone,
  created_at   timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.notifications
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.notifications TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.notifications TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.notifications TO service_role;

CREATE INDEX idx_notification_read ON public.notifications (read_at);

CREATE INDEX idx_notification_user ON public.notifications (user_id);

CREATE INDEX idx_notification_tenant ON public.notifications (tenant_id);

CREATE INDEX idx_notification_created ON public.notifications (created_at DESC);

CREATE POLICY "Members can create tenant Notifications" ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE POLICY "Members can delete tenant Notifications" ON public.notifications
  FOR DELETE
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE POLICY "Members can update tenant Notifications" ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()))
  WITH CHECK (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE POLICY "Members can view tenant Notifications" ON public.notifications
  FOR SELECT
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE TABLE public.plans (
  id               uuid                     DEFAULT gen_random_uuid() NOT NULL,
  code             text                     NOT NULL,
  name             text                     NOT NULL,
  description      text,
  price_month      numeric(10,2)            DEFAULT 0 NOT NULL,
  seat_limit       integer                  NOT NULL,
  ticket_limit     integer,
  storage_limit_mb integer                  DEFAULT 1024,
  features_json    jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  is_active        boolean                  DEFAULT true NOT NULL,
  sort_order       integer                  DEFAULT 0 NOT NULL,
  created_at       timestamp with time zone DEFAULT now() NOT NULL,
  updated_at       timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.plans IS 'Master subscription plans';

COMMENT ON COLUMN public.plans.code IS 'FREE, PRO, BUSINESS';

COMMENT ON COLUMN public.plans.features_json IS 'Feature flags for UI';

ALTER TABLE public.plans
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.plans
  ADD CONSTRAINT chk_plan_price CHECK (price_month >= 0::numeric);

ALTER TABLE public.plans
  ADD CONSTRAINT chk_seat_limit CHECK (seat_limit >= 1);

ALTER TABLE public.plans
  ADD CONSTRAINT chk_storage_limit CHECK (storage_limit_mb >= 0);

ALTER TABLE public.plans
  ADD CONSTRAINT plans_code_key UNIQUE (code);

ALTER TABLE public.plans
  ADD CONSTRAINT plans_pkey PRIMARY KEY (id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.plans TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.plans TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.plans TO service_role;

CREATE POLICY plans_select ON public.plans
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE public.saved_views (
  id            uuid                     DEFAULT gen_random_uuid() NOT NULL,
  tenant_id     uuid                     NOT NULL,
  owner_user_id uuid                     NOT NULL,
  name          text                     NOT NULL,
  filter_json   jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  is_shared     boolean                  DEFAULT false NOT NULL,
  created_at    timestamp with time zone DEFAULT now(),
  updated_at    timestamp with time zone DEFAULT now()
);

ALTER TABLE public.saved_views
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.saved_views
  ADD CONSTRAINT saved_views_pkey PRIMARY KEY (id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.saved_views TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.saved_views TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.saved_views TO service_role;

CREATE POLICY "Members can create tenant Saved View" ON public.saved_views
  FOR INSERT
  TO authenticated
  WITH CHECK (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE POLICY "Members can delete tenant Saved View" ON public.saved_views
  FOR DELETE
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE POLICY "Members can update tenant Saved View" ON public.saved_views
  FOR UPDATE
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()))
  WITH CHECK (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE POLICY "Members can view tenant Saved View" ON public.saved_views
  FOR SELECT
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE TABLE public.sla_events (
  id           uuid                     DEFAULT gen_random_uuid() NOT NULL,
  tenant_id    uuid                     NOT NULL,
  ticket_id    uuid                     NOT NULL,
  type         public.sla_event_type    NOT NULL,
  status       public.sla_event_status  DEFAULT 'pending'::public.sla_event_status NOT NULL,
  due_at       timestamp with time zone NOT NULL,
  completed_at timestamp with time zone,
  breached_at  timestamp with time zone,
  created_at   timestamp with time zone DEFAULT now() NOT NULL,
  updated_at   timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.sla_events
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sla_events
  ADD CONSTRAINT sla_events_pkey PRIMARY KEY (id);

ALTER TABLE public.sla_events
  ADD CONSTRAINT uq_ticket_sla_type UNIQUE (ticket_id, TYPE);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.sla_events TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.sla_events TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.sla_events TO service_role;

CREATE INDEX idx_sla_events_status_due ON public.sla_events (status, due_at);

CREATE INDEX idx_sla_events_tenant ON public.sla_events (tenant_id);

CREATE INDEX idx_sla_events_ticket ON public.sla_events (ticket_id);

CREATE POLICY "Members can create tenant SLA events" ON public.sla_events
  FOR INSERT
  TO authenticated
  WITH CHECK (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE POLICY "Members can delete tenant SLA events" ON public.sla_events
  FOR DELETE
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE POLICY "Members can update tenant SLA events" ON public.sla_events
  FOR UPDATE
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()))
  WITH CHECK (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE POLICY "Members can view tenant SLA events" ON public.sla_events
  FOR SELECT
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND public.is_active_membership()));

CREATE TABLE public.sla_policies (
  id                  uuid                     DEFAULT gen_random_uuid() NOT NULL,
  tenant_id           uuid                     NOT NULL,
  name                text                     NOT NULL,
  first_response_mins integer                  NOT NULL,
  resolution_mins     integer                  NOT NULL,
  priority_scope      public.ticket_priority   NOT NULL,
  business_hours_id   uuid,
  is_default          boolean                  DEFAULT true,
  created_at          timestamp with time zone DEFAULT now(),
  updated_at          timestamp with time zone DEFAULT now()
);

ALTER TABLE public.sla_policies
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sla_policies
  ADD CONSTRAINT sla_policies_business_hours_id_fkey FOREIGN KEY (business_hours_id) REFERENCES public.business_hours(id);

ALTER TABLE public.sla_policies
  ADD CONSTRAINT sla_policies_pkey PRIMARY KEY (id);

ALTER TABLE public.sla_policies
  ADD CONSTRAINT uq_sla_priority UNIQUE (tenant_id, priority_scope);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.sla_policies TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.sla_policies TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.sla_policies TO service_role;

CREATE POLICY sla_delete ON public.sla_policies
  FOR DELETE
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND ((auth.jwt() ->> 'tenant_role'::text) = 'tenant_admin'::text)));

CREATE POLICY sla_insert ON public.sla_policies
  FOR INSERT
  TO authenticated
  WITH CHECK (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND ((auth.jwt() ->> 'tenant_role'::text) = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))));

CREATE POLICY sla_select ON public.sla_policies
  FOR SELECT
  TO authenticated
  USING ((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid));

CREATE POLICY sla_update ON public.sla_policies
  FOR UPDATE
  TO authenticated
  USING (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND ((auth.jwt() ->> 'tenant_role'::text) = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))))
  WITH CHECK (((tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid) AND ((auth.jwt() ->> 'tenant_role'::text) = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))));

CREATE TABLE public.subscriptions (
  id                     uuid                       DEFAULT gen_random_uuid() NOT NULL,
  tenant_id              uuid                       NOT NULL,
  paypal_subscription_id text                       NOT NULL,
  plan_id                uuid                       NOT NULL,
  status                 public.subscription_status NOT NULL,
  current_period_end     timestamp with time zone,
  seats                  integer                    DEFAULT 1 NOT NULL,
  created_at             timestamp with time zone   DEFAULT now(),
  updated_at             timestamp with time zone   DEFAULT now()
);

ALTER TABLE public.subscriptions
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT chk_subscription_seats CHECK (seats >= 1);

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_paypal_subscription_id_key UNIQUE (paypal_subscription_id);

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id);

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_tenant_id_key UNIQUE (tenant_id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.subscriptions TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.subscriptions TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.subscriptions TO service_role;

CREATE POLICY subscriptions_delete ON public.subscriptions
  FOR DELETE
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND public.is_active_membership() AND (public."current_role"() = 'tenant_admin'::text)));

CREATE POLICY subscriptions_insert ON public.subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (((tenant_id = public.current_tenant_id()) AND public.is_active_membership() AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'billing_admin'::text]))));

CREATE POLICY subscriptions_select ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND public.is_active_membership() AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'billing_admin'::text]))));

CREATE POLICY subscriptions_update ON public.subscriptions
  FOR UPDATE
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND public.is_active_membership() AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'billing_admin'::text]))))
  WITH CHECK (((tenant_id = public.current_tenant_id()) AND public.is_active_membership() AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'billing_admin'::text]))));

CREATE TABLE public.tags (
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  tenant_id  uuid                     NOT NULL,
  name       text                     NOT NULL,
  color      text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.tags
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tags
  ADD CONSTRAINT tags_pkey PRIMARY KEY (id);

ALTER TABLE public.tags
  ADD CONSTRAINT uq_tag_name UNIQUE (tenant_id, name);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tags TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tags TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tags TO service_role;

CREATE POLICY tags_delete ON public.tags
  FOR DELETE
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))));

CREATE POLICY tags_insert ON public.tags
  FOR INSERT
  TO authenticated
  WITH CHECK (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))));

CREATE POLICY tags_select ON public.tags
  FOR SELECT
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text, 'agent'::text]))));

CREATE POLICY tags_update ON public.tags
  FOR UPDATE
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))))
  WITH CHECK (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))));

CREATE TABLE public.tenants (
  id            uuid                     DEFAULT gen_random_uuid() NOT NULL,
  name          text                     NOT NULL,
  slug          text                     NOT NULL,
  status        public.tenant_status     DEFAULT 'active'::public.tenant_status NOT NULL,
  plan_id       uuid                     NOT NULL,
  branding_json jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  created_at    timestamp with time zone DEFAULT now() NOT NULL,
  updated_at    timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.tenants IS 'Root tenant record';

ALTER TABLE public.tenants
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);

ALTER TABLE public.attachments
  ADD CONSTRAINT attachments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.business_hours
  ADD CONSTRAINT business_hours_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.notification_prefs
  ADD CONSTRAINT notification_prefs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.saved_views
  ADD CONSTRAINT saved_views_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.sla_events
  ADD CONSTRAINT sla_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.sla_policies
  ADD CONSTRAINT sla_policies_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.tags
  ADD CONSTRAINT tags_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id);

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_slug_key UNIQUE (slug);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tenants TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tenants TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tenants TO service_role;

CREATE INDEX idx_tenant_status ON public.tenants (status);

CREATE UNIQUE INDEX idx_tenant_slug ON public.tenants (slug);

CREATE INDEX idx_tenant_plan ON public.tenants (plan_id);

CREATE TRIGGER set_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY tenants_delete ON public.tenants
  FOR DELETE
  TO authenticated
  USING (((id = public.current_tenant_id()) AND (public."current_role"() = 'tenant_admin'::text)));

CREATE POLICY tenants_insert ON public.tenants
  FOR INSERT
  TO authenticated
  WITH CHECK ((public."current_role"() = 'tenant_admin'::text));

CREATE POLICY tenants_select ON public.tenants
  FOR SELECT
  TO authenticated
  USING ((id = public.current_tenant_id()));

CREATE POLICY tenants_update ON public.tenants
  FOR UPDATE
  TO authenticated
  USING (((id = public.current_tenant_id()) AND (public."current_role"() = 'tenant_admin'::text)))
  WITH CHECK (((id = public.current_tenant_id()) AND (public."current_role"() = 'tenant_admin'::text)));

CREATE TABLE public.ticket_messages (
  id          uuid                      DEFAULT gen_random_uuid() NOT NULL,
  tenant_id   uuid                      NOT NULL,
  ticket_id   uuid                      NOT NULL,
  author_type public.author_type        NOT NULL,
  author_id   uuid                      NOT NULL,
  body        text                      NOT NULL,
  visibility  public.message_visibility DEFAULT 'public'::public.message_visibility NOT NULL,
  is_edited   boolean                   DEFAULT false NOT NULL,
  edited_at   timestamp with time zone,
  created_at  timestamp with time zone  DEFAULT now() NOT NULL,
  updated_at  timestamp with time zone  DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.ticket_messages IS 'Conversation messages for a ticket';

COMMENT ON COLUMN public.ticket_messages.author_type IS 'agent | customer | system';

COMMENT ON COLUMN public.ticket_messages.visibility IS 'public or internal';

ALTER TABLE public.ticket_messages
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ticket_messages
  ADD CONSTRAINT chk_message_body CHECK (length(TRIM(BOTH FROM body)) > 0);

ALTER TABLE public.ticket_messages
  ADD CONSTRAINT ticket_messages_pkey PRIMARY KEY (id);

ALTER TABLE public.attachments
  ADD CONSTRAINT attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.ticket_messages(id) ON DELETE CASCADE;

ALTER TABLE public.ticket_messages
  ADD CONSTRAINT ticket_messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.ticket_messages TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.ticket_messages TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.ticket_messages TO service_role;

CREATE INDEX idx_ticket_messages_tenant ON public.ticket_messages (tenant_id);

CREATE INDEX idx_ticket_messages_ticket ON public.ticket_messages (ticket_id);

CREATE INDEX idx_ticket_messages_author ON public.ticket_messages (author_id);

CREATE INDEX idx_ticket_messages_created ON public.ticket_messages (created_at DESC);

CREATE INDEX idx_ticket_messages_visibility ON public.ticket_messages (visibility);

CREATE INDEX idx_ticket_messages_search ON public.ticket_messages USING gin (to_tsvector('english'::regconfig, COALESCE(body, ''::text)));

CREATE POLICY ticket_messages_delete ON public.ticket_messages
  FOR DELETE
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text]))));

CREATE POLICY ticket_messages_update ON public.ticket_messages
  FOR UPDATE
  TO authenticated
  USING
    (((tenant_id = public.current_tenant_id()) AND ((public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text])) OR ((public."current_role"() = 'agent'::text) AND
    (author_type = 'agent'::public.author_type) AND (author_id = auth.uid())) OR
    ((public."current_role"() = 'customer'::text) AND (author_type = 'customer'::public.author_type) AND (visibility = 'public'::public.message_visibility) AND (EXISTS ( SELECT 1
   FROM public.customers c
  WHERE ((c.id = ticket_messages.author_id) AND (c.portal_user_id = auth.uid()) AND (c.tenant_id = public.current_tenant_id()))))))))
  WITH
    CHECK
    (((tenant_id = public.current_tenant_id()) AND ((public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text])) OR ((public."current_role"() = 'agent'::text) AND
    (author_type = 'agent'::public.author_type) AND (author_id = auth.uid())) OR
    ((public."current_role"() = 'customer'::text) AND (author_type = 'customer'::public.author_type) AND (visibility = 'public'::public.message_visibility) AND (EXISTS ( SELECT 1
   FROM public.customers c
  WHERE ((c.id = ticket_messages.author_id) AND (c.portal_user_id = auth.uid()) AND (c.tenant_id = public.current_tenant_id()))))))));

CREATE TABLE public.ticket_tags (
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  tenant_id  uuid                     NOT NULL,
  ticket_id  uuid                     NOT NULL,
  tag_id     uuid                     NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.ticket_tags
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ticket_tags
  ADD CONSTRAINT ticket_tags_pkey PRIMARY KEY (id);

ALTER TABLE public.ticket_tags
  ADD CONSTRAINT ticket_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;

ALTER TABLE public.ticket_tags
  ADD CONSTRAINT ticket_tags_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.ticket_tags
  ADD CONSTRAINT uq_ticket_tag UNIQUE (ticket_id, tag_id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.ticket_tags TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.ticket_tags TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.ticket_tags TO service_role;

CREATE INDEX idx_ticket_tags_tenant ON public.ticket_tags (tenant_id);

CREATE INDEX idx_ticket_tags_tag ON public.ticket_tags (tag_id);

CREATE INDEX idx_ticket_tags_ticket ON public.ticket_tags (ticket_id);

CREATE POLICY ticket_tags_delete ON public.ticket_tags
  FOR DELETE
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text, 'agent'::text]))));

CREATE POLICY ticket_tags_insert ON public.ticket_tags
  FOR INSERT
  TO authenticated
  WITH CHECK (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text, 'agent'::text]))));

CREATE POLICY ticket_tags_select ON public.ticket_tags
  FOR SELECT
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text, 'agent'::text]))));

CREATE TABLE public.tickets (
  id                    uuid                     DEFAULT gen_random_uuid() NOT NULL,
  tenant_id             uuid                     NOT NULL,
  number                bigint                   NOT NULL,
  subject               text                     NOT NULL,
  description           text                     NOT NULL,
  status                public.ticket_status     DEFAULT 'new'::public.ticket_status NOT NULL,
  priority              public.ticket_priority   DEFAULT 'normal'::public.ticket_priority NOT NULL,
  requester_customer_id uuid                     NOT NULL,
  assignee_user_id      uuid,
  sla_policy_id         uuid,
  first_response_at     timestamp with time zone,
  resolved_at           timestamp with time zone,
  closed_at             timestamp with time zone,
  created_at            timestamp with time zone DEFAULT now() NOT NULL,
  updated_at            timestamp with time zone DEFAULT now() NOT NULL
);

CREATE POLICY ticket_messages_insert ON public.ticket_messages
  FOR INSERT
  TO authenticated
  WITH
    CHECK
    (((tenant_id = public.current_tenant_id()) AND (((public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text, 'agent'::text])) AND (author_type =
    'agent'::public.author_type) AND (author_id = auth.uid())) OR
    ((public."current_role"() = 'customer'::text) AND (author_type = 'customer'::public.author_type) AND (visibility = 'public'::public.message_visibility) AND (EXISTS ( SELECT 1
   FROM (public.customers c
     JOIN public.tickets t ON ((t.requester_customer_id = c.id)))
  WHERE
    ((c.id = ticket_messages.author_id) AND (c.portal_user_id = auth.uid()) AND (c.tenant_id = public.current_tenant_id()) AND (t.id = ticket_messages.ticket_id) AND (t.tenant_id =
    public.current_tenant_id()))))))));

CREATE POLICY ticket_messages_select ON public.ticket_messages
  FOR SELECT
  TO authenticated
  USING
    (((tenant_id = public.current_tenant_id()) AND ((public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text, 'agent'::text])) OR ((public."current_role"() =
    'customer'::text) AND (visibility = 'public'::public.message_visibility) AND (EXISTS ( SELECT 1
   FROM (public.tickets t
     JOIN public.customers c ON ((c.id = t.requester_customer_id)))
  WHERE ((t.id = ticket_messages.ticket_id) AND (t.tenant_id = public.current_tenant_id()) AND (c.portal_user_id = auth.uid()) AND (c.tenant_id = public.current_tenant_id()))))))));

COMMENT ON TABLE public.tickets IS 'Support tickets';

COMMENT ON COLUMN public.tickets.number IS 'Sequential ticket number per tenant';

ALTER TABLE public.tickets
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);

ALTER TABLE public.attachments
  ADD CONSTRAINT attachments_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;

ALTER TABLE public.sla_events
  ADD CONSTRAINT sla_events_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;

ALTER TABLE public.ticket_messages
  ADD CONSTRAINT ticket_messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;

ALTER TABLE public.ticket_tags
  ADD CONSTRAINT ticket_tags_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_requester_customer_id_fkey FOREIGN KEY (requester_customer_id) REFERENCES public.customers(id);

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_sla_policy_id_fkey FOREIGN KEY (sla_policy_id) REFERENCES public.sla_policies(id);

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.tickets
  ADD CONSTRAINT uq_ticket_number UNIQUE (tenant_id, number);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tickets TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tickets TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tickets TO service_role;

CREATE INDEX idx_ticket_created ON public.tickets (created_at DESC);

CREATE INDEX idx_ticket_tenant ON public.tickets (tenant_id);

CREATE INDEX idx_ticket_status ON public.tickets (status);

CREATE INDEX idx_ticket_priority ON public.tickets (priority);

CREATE INDEX idx_ticket_assignee ON public.tickets (assignee_user_id);

CREATE INDEX idx_ticket_requester ON public.tickets (requester_customer_id);

CREATE INDEX idx_ticket_search ON public.tickets USING gin (to_tsvector('english'::regconfig, (COALESCE(subject, ''::text) || ' '::text) || COALESCE(description, ''::text)));

CREATE POLICY tickets_delete ON public.tickets
  FOR DELETE
  TO authenticated
  USING (((tenant_id = public.current_tenant_id()) AND (public."current_role"() = 'tenant_admin'::text)));

CREATE POLICY tickets_insert ON public.tickets
  FOR INSERT
  TO authenticated
  WITH
    CHECK
    (((tenant_id = public.current_tenant_id()) AND ((public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text, 'agent'::text])) OR (requester_customer_id = (
    SELECT c.id
   FROM public.customers c
  WHERE ((c.portal_user_id = auth.uid()) AND (c.tenant_id = tickets.tenant_id)))))));

CREATE POLICY tickets_select ON public.tickets
  FOR SELECT
  TO authenticated
  USING
    (((tenant_id = public.current_tenant_id()) AND ((public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text, 'agent'::text])) OR (requester_customer_id = (
    SELECT c.id
   FROM public.customers c
  WHERE ((c.portal_user_id = auth.uid()) AND (c.tenant_id = tickets.tenant_id)))))));

CREATE POLICY tickets_update ON public.tickets
  FOR UPDATE
  TO authenticated
  USING
    (((tenant_id = public.current_tenant_id()) AND ((public."current_role"() = ANY (ARRAY['tenant_admin'::text, 'manager'::text, 'agent'::text])) OR (requester_customer_id = (
    SELECT c.id
   FROM public.customers c
  WHERE ((c.portal_user_id = auth.uid()) AND (c.tenant_id = tickets.tenant_id)))))))
  WITH CHECK ((tenant_id = public.current_tenant_id()));

CREATE TABLE public.timezones (
  id           uuid                     DEFAULT gen_random_uuid() NOT NULL,
  code         text                     NOT NULL,
  display_name text                     NOT NULL,
  country      text,
  created_at   timestamp with time zone DEFAULT now() NOT NULL,
  updated_at   timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.timezones IS 'Master catalog of IANA time zones.';

COMMENT ON COLUMN public.timezones.code IS 'IANA timezone identifier (e.g. Asia/Kolkata).';

COMMENT ON COLUMN public.timezones.display_name IS 'Human-readable timezone name.';

ALTER TABLE public.timezones
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.timezones
  ADD CONSTRAINT chk_timezone_code CHECK (length(code) > 0);

ALTER TABLE public.timezones
  ADD CONSTRAINT timezones_code_key UNIQUE (code);

ALTER TABLE public.timezones
  ADD CONSTRAINT timezones_pkey PRIMARY KEY (id);

ALTER TABLE public.business_hours
  ADD CONSTRAINT business_hours_timezone_id_fkey FOREIGN KEY (timezone_id) REFERENCES public.timezones(id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.timezones TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.timezones TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.timezones TO service_role;

CREATE POLICY timezones_select ON public.timezones
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE public.users (
  id         uuid                     NOT NULL,
  email      public.citext            NOT NULL,
  full_name  text                     NOT NULL,
  avatar_url text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.users IS 'Application users linked 1:1 with Supabase auth.users';

COMMENT ON COLUMN public.users.id IS 'Supabase Auth User ID';

COMMENT ON COLUMN public.users.email IS 'Unique login email';

COMMENT ON COLUMN public.users.avatar_url IS 'Profile image';

ALTER TABLE public.users
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.users
  ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE public.users
  ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.users
  ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE public.attachments
  ADD CONSTRAINT attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id);

ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.notification_prefs
  ADD CONSTRAINT notification_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.saved_views
  ADD CONSTRAINT saved_views_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_assignee_user_id_fkey FOREIGN KEY (assignee_user_id) REFERENCES public.users(id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.users TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.users TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.users TO service_role;

CREATE POLICY users_delete ON public.users
  FOR DELETE
  TO authenticated
  USING (((public."current_role"() = 'tenant_admin'::text) AND public.is_active_membership() AND (EXISTS ( SELECT 1
   FROM public.memberships m
  WHERE ((m.user_id = users.id) AND (m.tenant_id = public.current_tenant_id()) AND (m.status = 'active'::public.membership_status))))));

CREATE POLICY users_insert ON public.users
  FOR INSERT
  TO authenticated
  WITH CHECK ((id = auth.uid()));

CREATE POLICY users_select ON public.users
  FOR SELECT
  TO authenticated
  USING (((id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.memberships m
  WHERE ((m.user_id = users.id) AND (m.tenant_id = public.current_tenant_id()) AND (m.status = 'active'::public.membership_status))))));

CREATE POLICY users_update ON public.users
  FOR UPDATE
  TO authenticated
  USING (((id = auth.uid()) OR ((public."current_role"() = 'tenant_admin'::text) AND public.is_active_membership() AND (EXISTS ( SELECT 1
   FROM public.memberships m
  WHERE ((m.user_id = users.id) AND (m.tenant_id = public.current_tenant_id()) AND (m.status = 'active'::public.membership_status)))))))
  WITH CHECK (((id = auth.uid()) OR ((public."current_role"() = 'tenant_admin'::text) AND public.is_active_membership() AND (EXISTS ( SELECT 1
   FROM public.memberships m
  WHERE ((m.user_id = users.id) AND (m.tenant_id = public.current_tenant_id()) AND (m.status = 'active'::public.membership_status)))))));