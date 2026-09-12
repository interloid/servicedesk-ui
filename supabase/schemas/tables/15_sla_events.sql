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
