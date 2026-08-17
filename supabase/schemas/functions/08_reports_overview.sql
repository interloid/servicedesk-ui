-- =====================================================
-- File: 08_reports_overview.sql
-- Description: Every aggregate the Reports screen renders, in one round trip.
-- =====================================================
--
-- SECURITY INVOKER (the default, stated explicitly because it is the whole security
-- design). The function runs as the CALLER, so `tickets_select`, `sla_events` and
-- `memberships_select` are what scope every row it reads. There is deliberately NO
-- `tenant_id = current_tenant_id()` anywhere below: a filter here would read as the
-- boundary while RLS quietly did the real work, and the two would drift. Same rule
-- `features/tickets/services/ticket.service.ts` states for its queries.
--
-- Why an RPC rather than client-side reduction: the medians are `percentile_cont`, which
-- has no client equivalent that isn't "fetch every ticket and sort in JavaScript". The
-- weekly series additionally needs a generated week spine so empty weeks still render a
-- bar. Both are cheap in Postgres and neither is expressible in PostgREST filters.
--
-- Two things the design draws are NOT here, and cannot be:
--   · CSAT — no satisfaction/rating table exists anywhere in the schema.
--   · business-hours-aware durations — every duration below is WALL CLOCK. Honouring
--     `business_hours.schedule_json` is a real calculation, not a swap. Deferred; the UI
--     says so rather than presenting wall-clock as business-hours.

CREATE OR REPLACE FUNCTION public.reports_overview(
    p_days  integer DEFAULT 30,
    p_weeks integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH bounds AS (
    SELECT
        now() - make_interval(days => p_days)     AS cur_start,
        now() - make_interval(days => p_days * 2) AS prev_start
),

-- Every ticket / SLA clock the CALLER may see. RLS has already run by the time these
-- CTEs are scanned.
t AS (
    SELECT * FROM public.tickets
),
e AS (
    SELECT ev.*, coalesce(ev.completed_at, ev.breached_at) AS closed_at
    FROM public.sla_events ev
),

-- ── Volume ────────────────────────────────────────────────────────────────────
volume AS (
    SELECT
        count(*) FILTER (WHERE t.created_at  >= b.cur_start) AS created,
        count(*) FILTER (WHERE t.resolved_at >= b.cur_start) AS resolved
    FROM t CROSS JOIN bounds b
),

-- ── Status breakdown / priority mix (tickets raised in the period) ────────────
status_breakdown AS (
    SELECT t.status::text AS status, count(*) AS tickets
    FROM t CROSS JOIN bounds b
    WHERE t.created_at >= b.cur_start
    GROUP BY t.status
),
priority_mix AS (
    SELECT t.priority::text AS priority, count(*) AS tickets
    FROM t CROSS JOIN bounds b
    WHERE t.created_at >= b.cur_start
    GROUP BY t.priority
),

-- ── SLA attainment by priority — RESOLUTION clocks that closed in the period ──
sla_by_priority AS (
    SELECT
        t.priority::text AS priority,
        count(*)                                        AS tickets,
        count(*) FILTER (WHERE e.status = 'completed')   AS met
    FROM e
    JOIN t ON t.id = e.ticket_id
    CROSS JOIN bounds b
    WHERE e.type = 'resolution'
      AND e.closed_at >= b.cur_start
    GROUP BY t.priority
),

-- ── Org attainment — BOTH clocks, current vs previous period ──────────────────
attainment AS (
    SELECT
        count(*) FILTER (WHERE e.closed_at >= b.cur_start)                              AS cur_total,
        count(*) FILTER (WHERE e.closed_at >= b.cur_start AND e.status = 'completed')   AS cur_met,
        count(*) FILTER (WHERE e.closed_at >= b.prev_start AND e.closed_at < b.cur_start) AS prev_total,
        count(*) FILTER (WHERE e.closed_at >= b.prev_start AND e.closed_at < b.cur_start
                           AND e.status = 'completed')                                  AS prev_met
    FROM e CROSS JOIN bounds b
    WHERE e.closed_at IS NOT NULL
),

-- ── First response ────────────────────────────────────────────────────────────
median_first_response AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (
               ORDER BY extract(epoch FROM (t.first_response_at - t.created_at)) / 60
           ) AS minutes
    FROM t CROSS JOIN bounds b
    WHERE t.first_response_at IS NOT NULL
      AND t.first_response_at >= b.cur_start
),

-- A generated week spine, so a week with no first responses still renders a bar at 0
-- rather than dropping a column out of the chart.
week_spine AS (
    SELECT generate_series(
        date_trunc('week', now()) - make_interval(weeks => p_weeks - 1),
        date_trunc('week', now()),
        interval '1 week'
    ) AS wk
),
first_response_weeks AS (
    SELECT
        to_char(w.wk, '"W"IW') AS week,
        coalesce(
            round(percentile_cont(0.5) WITHIN GROUP (
                ORDER BY extract(epoch FROM (t.first_response_at - t.created_at)) / 60
            ))::int,
            0
        ) AS minutes,
        w.wk
    FROM week_spine w
    LEFT JOIN t
           ON t.first_response_at >= w.wk
          AND t.first_response_at <  w.wk + interval '1 week'
    GROUP BY w.wk
),

-- ── Resolution times (wall clock — see the header note) ───────────────────────
resolution AS (
    SELECT
        round((percentile_cont(0.5) WITHIN GROUP (
            ORDER BY extract(epoch FROM (t.resolved_at - t.created_at)) / 3600))::numeric, 1) AS median_hours,
        round((percentile_cont(0.9) WITHIN GROUP (
            ORDER BY extract(epoch FROM (t.resolved_at - t.created_at)) / 3600))::numeric, 1) AS p90_hours
    FROM t CROSS JOIN bounds b
    WHERE t.resolved_at IS NOT NULL
      AND t.resolved_at >= b.cur_start
),

-- ── Agent load ────────────────────────────────────────────────────────────────
agents AS (
    SELECT u.id, u.full_name
    FROM public.users u
    JOIN public.memberships m
      ON m.user_id = u.id
     AND m.status  = 'active'
),
-- Split from the SLA counts on purpose: joining `e` here would multiply each ticket by
-- its clocks and silently double `open` and `solved`.
agent_tickets AS (
    SELECT
        a.id,
        a.full_name,
        count(t.id) FILTER (WHERE t.status NOT IN ('resolved', 'closed'))  AS open,
        count(t.id) FILTER (WHERE t.resolved_at >= b.cur_start)            AS solved,
        coalesce(
            round(percentile_cont(0.5) WITHIN GROUP (
                ORDER BY extract(epoch FROM (t.first_response_at - t.created_at)) / 60
            ))::int,
            0
        ) AS median_first_reply_min
    FROM agents a
    CROSS JOIN bounds b
    LEFT JOIN t ON t.assignee_user_id = a.id
    GROUP BY a.id, a.full_name
),
agent_sla AS (
    SELECT
        t.assignee_user_id                              AS id,
        count(*) FILTER (WHERE e.status = 'completed')  AS sla_met,
        count(*)                                        AS sla_total
    FROM e
    JOIN t ON t.id = e.ticket_id
    CROSS JOIN bounds b
    WHERE e.closed_at >= b.cur_start
      AND t.assignee_user_id IS NOT NULL
    GROUP BY t.assignee_user_id
),
agent_load AS (
    SELECT
        at.id,
        at.full_name,
        at.open,
        at.solved,
        at.median_first_reply_min,
        coalesce(s.sla_met, 0)   AS sla_met,
        coalesce(s.sla_total, 0) AS sla_total
    FROM agent_tickets at
    LEFT JOIN agent_sla s ON s.id = at.id
    ORDER BY at.solved DESC, at.full_name
),

-- The dashed target line on the chart. Read off the tenant's own `normal` target
-- on its default (or oldest active) policy, falling back to 60 when none exists.
target AS (
    SELECT coalesce(
        (SELECT t.first_response_mins
           FROM public.sla_policy_targets t
           JOIN public.sla_policies p ON p.id = t.policy_id
          WHERE t.priority_scope = 'normal'
            AND p.status = 'active'
          ORDER BY p.is_default DESC, p.created_at ASC
          LIMIT 1),
        60
    ) AS first_response_target_min
)

SELECT jsonb_build_object(
    'period_days', p_days,

    'volume', (SELECT jsonb_build_object('created', created, 'resolved', resolved) FROM volume),

    'tickets_solved', (SELECT resolved FROM volume),

    'status_breakdown', coalesce(
        (SELECT jsonb_agg(jsonb_build_object('status', status, 'tickets', tickets) ORDER BY tickets DESC)
           FROM status_breakdown), '[]'::jsonb),

    'priority_mix', coalesce(
        (SELECT jsonb_agg(jsonb_build_object('priority', priority, 'tickets', tickets) ORDER BY tickets DESC)
           FROM priority_mix), '[]'::jsonb),

    'sla_by_priority', coalesce(
        (SELECT jsonb_agg(jsonb_build_object('priority', priority, 'tickets', tickets, 'met', met))
           FROM sla_by_priority), '[]'::jsonb),

    'sla_clocks', (SELECT jsonb_build_object(
        'cur_total', cur_total, 'cur_met', cur_met,
        'prev_total', prev_total, 'prev_met', prev_met) FROM attainment),

    'median_first_response_min',
        (SELECT coalesce(round(minutes)::int, 0) FROM median_first_response),

    'first_response_target_min', (SELECT first_response_target_min FROM target),

    'first_response_weeks', coalesce(
        (SELECT jsonb_agg(jsonb_build_object('week', week, 'minutes', minutes) ORDER BY wk)
           FROM first_response_weeks), '[]'::jsonb),

    'resolution', (SELECT jsonb_build_object(
        'median_hours', median_hours, 'p90_hours', p90_hours) FROM resolution),

    'agent_load', coalesce(
        (SELECT jsonb_agg(jsonb_build_object(
            'id', id, 'full_name', full_name, 'open', open, 'solved', solved,
            'median_first_reply_min', median_first_reply_min,
            'sla_met', sla_met, 'sla_total', sla_total))
           FROM agent_load), '[]'::jsonb)
);
$$;

REVOKE EXECUTE ON FUNCTION public.reports_overview(integer, integer) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.reports_overview(integer, integer) TO authenticated;
