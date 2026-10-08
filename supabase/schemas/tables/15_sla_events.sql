-- =====================================================
-- File: 15_sla_events.sql
-- Description: Ticket SLA Events
-- =====================================================

CREATE TABLE IF NOT EXISTS public.sla_events
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id UUID NOT NULL
        REFERENCES public.tenants(id) ON DELETE CASCADE,

    ticket_id UUID NOT NULL
        REFERENCES public.tickets(id) ON DELETE CASCADE,

    type public.sla_event_type NOT NULL,

    status public.sla_event_status NOT NULL DEFAULT 'pending',

    due_at TIMESTAMPTZ NOT NULL,

    completed_at TIMESTAMPTZ,

    breached_at TIMESTAMPTZ,

    -- When this clock started: the ticket's created_at, or the reopen time
    -- for a restarted resolution clock.
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- The target the clock runs against, kept so a priority change can
    -- re-target it without losing the time already used.
    target_mins INTEGER,

    -- The calendar it counts in; null means wall-clock (24/7).
    business_hours_id UUID
        REFERENCES public.business_hours(id) ON DELETE SET NULL,

    -- Set while the ticket is Pending / On hold; due_at is re-derived from
    -- remaining_secs on resume.
    paused_at TIMESTAMPTZ,
    remaining_secs BIGINT,

    -- Whether sla_tick() has sent the due-soon / breach notifications.
    warned_at TIMESTAMPTZ,
    breach_notified_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_ticket_sla_type
        UNIQUE (ticket_id, type)
);

CREATE INDEX idx_sla_events_ticket
    ON public.sla_events(ticket_id);

CREATE INDEX idx_sla_events_tenant
    ON public.sla_events(tenant_id);

CREATE INDEX idx_sla_events_status_due
    ON public.sla_events(status, due_at);

CREATE INDEX idx_sla_events_tick
    ON public.sla_events(due_at)
    WHERE status = 'pending' AND paused_at IS NULL;
