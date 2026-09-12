-- =====================================================
-- File: 01_types.sql
-- Description: ENUM Types
-- =====================================================


-- =====================================================
-- Tenant
-- =====================================================

CREATE TYPE public.tenant_status AS ENUM (
    'active',
    'suspended',
    'cancelled'
);


-- =====================================================
-- Membership
-- =====================================================

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


-- =====================================================
-- Customer
-- =====================================================

CREATE TYPE public.customer_status AS ENUM (
    'active',
    'blocked'
);


-- =====================================================
-- Ticket
-- =====================================================

CREATE TYPE public.ticket_status AS ENUM (
    'new',
    'open',
    'pending',
    'on_hold',
    'resolved',
    'closed'
);

CREATE TYPE public.ticket_priority AS ENUM (
    'low',
    'normal',
    'high',
    'urgent'
);


-- =====================================================
-- Messages
-- =====================================================

CREATE TYPE public.author_type AS ENUM (
    'agent',
    'customer',
    'system'
);

CREATE TYPE public.message_visibility AS ENUM (
    'public',
    'internal'
);


-- =====================================================
-- SLA
-- =====================================================

CREATE TYPE public.sla_event_type AS ENUM (
    'first_response',
    'resolution'
);

CREATE TYPE public.sla_event_status AS ENUM (
    'pending',
    'completed',
    'breached'
);

-- One designed policy is a named container; its lifecycle is independent of the
-- per-priority targets hanging off it. See tables/09_sla_policies.sql.
CREATE TYPE public.sla_policy_status AS ENUM (
    'active',
    'paused',
    'draft'
);


-- =====================================================
-- Notification
-- =====================================================

CREATE TYPE public.notification_type AS ENUM (
    'ticket_assigned',
    'ticket_created',
    'ticket_updated',
    'ticket_closed',
    'mention',
    'billing',
    'system'
);


-- =====================================================
-- Billing
-- =====================================================

CREATE TYPE public.subscription_status AS ENUM (
    'trialing',
    'active',
    'past_due',
    'cancelled',
    'expired'
);

CREATE TYPE public.invoice_status AS ENUM (
    'pending',
    'paid',
    'failed',
    'refunded'
);


-- =====================================================
-- Audit
-- =====================================================

CREATE TYPE public.audit_action AS ENUM (
    'create',
    'update',
    'delete',
    'login',
    'logout',
    'invite',
    'assign'
);