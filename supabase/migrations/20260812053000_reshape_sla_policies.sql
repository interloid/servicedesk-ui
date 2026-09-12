-- =====================================================
-- Reshape sla_policies to match the designed grain
-- =====================================================
--
-- Before: one row PER priority under unique (tenant_id, priority_scope).
-- After:  one named policy container + sla_policy_targets rows (one per priority).
--
-- Also adds the four fields the editor already draws (status, applies_to,
-- notify_before_breach, escalate_on_breach) and consolidates the four
-- "Default SLA — …" rows register.service.ts seeded into a single policy.
--
-- Mirrors the declarative sources:
--   schemas/types/00_types.sql          (sla_policy_status)
--   schemas/tables/09_sla_policies.sql
--   schemas/tables/09a_sla_policy_targets.sql
--   schemas/policies/08_sla_policies.sql
--   schemas/policies/08a_sla_policy_targets.sql
--   schemas/functions/08_reports_overview.sql

-- ── 0. Helper the remote is missing ──────────────────────────────────────────
-- Initial schema created `public."current_role"()`. Declarative sources renamed it
-- to `current_tenant_role` (CURRENT_ROLE is a reserved keyword). Remote still only
-- has the old name; create the new one as a twin so new policies can use it without
-- rewriting every existing policy in this migration.

CREATE OR REPLACE FUNCTION public.current_tenant_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
SELECT auth.jwt()->>'tenant_role';
$$;

-- ── 1. Enum ──────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'sla_policy_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.sla_policy_status AS ENUM ('active', 'paused', 'draft');
  END IF;
END $$;

-- ── 2. New columns on sla_policies ───────────────────────────────────────────

ALTER TABLE public.sla_policies
  ADD COLUMN IF NOT EXISTS status public.sla_policy_status,
  ADD COLUMN IF NOT EXISTS applies_to text,
  ADD COLUMN IF NOT EXISTS notify_before_breach boolean,
  ADD COLUMN IF NOT EXISTS escalate_on_breach boolean;

UPDATE public.sla_policies
SET
  status                = coalesce(status, 'active'),
  applies_to            = coalesce(applies_to, 'All customers'),
  notify_before_breach  = coalesce(notify_before_breach, true),
  escalate_on_breach    = coalesce(escalate_on_breach, false),
  is_default            = coalesce(is_default, false);

ALTER TABLE public.sla_policies
  ALTER COLUMN status SET DEFAULT 'active',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN applies_to SET DEFAULT 'All customers',
  ALTER COLUMN applies_to SET NOT NULL,
  ALTER COLUMN notify_before_breach SET DEFAULT true,
  ALTER COLUMN notify_before_breach SET NOT NULL,
  ALTER COLUMN escalate_on_breach SET DEFAULT false,
  ALTER COLUMN escalate_on_breach SET NOT NULL,
  ALTER COLUMN is_default SET DEFAULT false,
  ALTER COLUMN is_default SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sla_policies_applies_to_check'
  ) THEN
    ALTER TABLE public.sla_policies
      ADD CONSTRAINT sla_policies_applies_to_check
      CHECK (
        applies_to IN (
          'Business & Enterprise customers',
          'All customers',
          'Urgent tickets only'
        )
      );
  END IF;
END $$;

-- ── 3. Targets table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sla_policy_targets
(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

    policy_id uuid NOT NULL REFERENCES public.sla_policies(id) ON DELETE CASCADE,

    priority_scope public.ticket_priority NOT NULL,

    first_response_mins integer NOT NULL CHECK (first_response_mins > 0),

    resolution_mins integer NOT NULL CHECK (resolution_mins > 0),

    first_response_business boolean NOT NULL DEFAULT false,

    resolution_business boolean NOT NULL DEFAULT false,

    created_at timestamptz NOT NULL DEFAULT now(),

    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_sla_policy_priority UNIQUE (policy_id, priority_scope),

    CONSTRAINT chk_sla_resolution_ge_first_response
      CHECK (resolution_mins >= first_response_mins)
);

CREATE INDEX IF NOT EXISTS idx_sla_policy_targets_policy
  ON public.sla_policy_targets(policy_id);

CREATE INDEX IF NOT EXISTS idx_sla_policy_targets_tenant
  ON public.sla_policy_targets(tenant_id);

CREATE INDEX IF NOT EXISTS idx_sla_policy_targets_priority
  ON public.sla_policy_targets(tenant_id, priority_scope);

CREATE INDEX IF NOT EXISTS idx_sla_policies_tenant
  ON public.sla_policies(tenant_id);

CREATE INDEX IF NOT EXISTS idx_sla_policies_tenant_default
  ON public.sla_policies(tenant_id)
  WHERE is_default;

COMMENT ON TABLE public.sla_policies IS
  'Named SLA policy containers. Targets by priority live in sla_policy_targets.';

COMMENT ON TABLE public.sla_policy_targets IS
  'Per-priority first-response and resolution targets for an sla_policies row.';

-- ── 4. Move legacy priority columns into targets + consolidate defaults ──────

DO $$
DECLARE
  has_legacy boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'sla_policies'
       AND column_name = 'priority_scope'
  ) INTO has_legacy;

  IF NOT has_legacy THEN
    RETURN;
  END IF;

  INSERT INTO public.sla_policy_targets (
    tenant_id,
    policy_id,
    priority_scope,
    first_response_mins,
    resolution_mins,
    first_response_business,
    resolution_business
  )
  SELECT
    p.tenant_id,
    p.id,
    p.priority_scope,
    p.first_response_mins,
    greatest(p.resolution_mins, p.first_response_mins),
    false,
    false
  FROM public.sla_policies p
  ON CONFLICT (policy_id, priority_scope) DO NOTHING;

  -- Move non-keeper default targets onto the oldest "Default SLA — …" row per tenant.
  UPDATE public.sla_policy_targets t
     SET policy_id = k.keeper_id
    FROM (
      SELECT
        id,
        tenant_id,
        ROW_NUMBER() OVER (
          PARTITION BY tenant_id
          ORDER BY created_at ASC, priority_scope ASC
        ) AS rn
      FROM public.sla_policies
      WHERE name LIKE 'Default SLA — %'
    ) d
    JOIN (
      SELECT id AS keeper_id, tenant_id
      FROM (
        SELECT
          id,
          tenant_id,
          ROW_NUMBER() OVER (
            PARTITION BY tenant_id
            ORDER BY created_at ASC, priority_scope ASC
          ) AS rn
        FROM public.sla_policies
        WHERE name LIKE 'Default SLA — %'
      ) x
      WHERE rn = 1
    ) k ON k.tenant_id = d.tenant_id
   WHERE t.policy_id = d.id
     AND d.rn > 1
     AND NOT EXISTS (
       SELECT 1
         FROM public.sla_policy_targets existing
        WHERE existing.policy_id = k.keeper_id
          AND existing.priority_scope = t.priority_scope
     );

  DELETE FROM public.sla_policy_targets t
   USING public.sla_policies p
   WHERE t.policy_id = p.id
     AND p.name LIKE 'Default SLA — %'
     AND p.id NOT IN (
       SELECT id FROM (
         SELECT
           id,
           ROW_NUMBER() OVER (
             PARTITION BY tenant_id
             ORDER BY created_at ASC, priority_scope ASC
           ) AS rn
         FROM public.sla_policies
         WHERE name LIKE 'Default SLA — %'
       ) keepers
       WHERE rn = 1
     );

  UPDATE public.tickets tk
     SET sla_policy_id = k.keeper_id
    FROM (
      SELECT
        id,
        tenant_id,
        ROW_NUMBER() OVER (
          PARTITION BY tenant_id
          ORDER BY created_at ASC, priority_scope ASC
        ) AS rn
      FROM public.sla_policies
      WHERE name LIKE 'Default SLA — %'
    ) d
    JOIN (
      SELECT id AS keeper_id, tenant_id
      FROM (
        SELECT
          id,
          tenant_id,
          ROW_NUMBER() OVER (
            PARTITION BY tenant_id
            ORDER BY created_at ASC, priority_scope ASC
          ) AS rn
        FROM public.sla_policies
        WHERE name LIKE 'Default SLA — %'
      ) x
      WHERE rn = 1
    ) k ON k.tenant_id = d.tenant_id
   WHERE tk.sla_policy_id = d.id
     AND d.rn > 1;

  DELETE FROM public.sla_policies p
   WHERE p.name LIKE 'Default SLA — %'
     AND p.id NOT IN (
       SELECT id FROM (
         SELECT
           id,
           ROW_NUMBER() OVER (
             PARTITION BY tenant_id
             ORDER BY created_at ASC, priority_scope ASC
           ) AS rn
         FROM public.sla_policies
         WHERE name LIKE 'Default SLA — %'
       ) keepers
       WHERE rn = 1
     );

  UPDATE public.sla_policies p
     SET name = 'Default SLA',
         is_default = true,
         status = 'active',
         applies_to = 'All customers',
         updated_at = now()
   WHERE p.name LIKE 'Default SLA — %'
      OR p.name = 'Default SLA';

  ALTER TABLE public.sla_policies
    DROP CONSTRAINT IF EXISTS uq_sla_priority;

  ALTER TABLE public.sla_policies
    DROP COLUMN IF EXISTS first_response_mins,
    DROP COLUMN IF EXISTS resolution_mins,
    DROP COLUMN IF EXISTS priority_scope;
END $$;

-- ── 5. Replace RLS on sla_policies ───────────────────────────────────────────

DROP POLICY IF EXISTS "sla_select" ON public.sla_policies;
DROP POLICY IF EXISTS "sla_insert" ON public.sla_policies;
DROP POLICY IF EXISTS "sla_update" ON public.sla_policies;
DROP POLICY IF EXISTS "sla_delete" ON public.sla_policies;
DROP POLICY IF EXISTS "sla_policies_select" ON public.sla_policies;
DROP POLICY IF EXISTS "sla_policies_insert" ON public.sla_policies;
DROP POLICY IF EXISTS "sla_policies_update" ON public.sla_policies;
DROP POLICY IF EXISTS "sla_policies_delete" ON public.sla_policies;

ALTER TABLE public.sla_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sla_policies_select"
ON public.sla_policies
FOR SELECT
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
);

CREATE POLICY "sla_policies_insert"
ON public.sla_policies
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
);

CREATE POLICY "sla_policies_update"
ON public.sla_policies
FOR UPDATE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
)
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
);

CREATE POLICY "sla_policies_delete"
ON public.sla_policies
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() = 'tenant_admin'
);

-- ── 6. RLS on sla_policy_targets ─────────────────────────────────────────────

ALTER TABLE public.sla_policy_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sla_policy_targets_select" ON public.sla_policy_targets;
DROP POLICY IF EXISTS "sla_policy_targets_insert" ON public.sla_policy_targets;
DROP POLICY IF EXISTS "sla_policy_targets_update" ON public.sla_policy_targets;
DROP POLICY IF EXISTS "sla_policy_targets_delete" ON public.sla_policy_targets;

CREATE POLICY "sla_policy_targets_select"
ON public.sla_policy_targets
FOR SELECT
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
);

CREATE POLICY "sla_policy_targets_insert"
ON public.sla_policy_targets
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
);

CREATE POLICY "sla_policy_targets_update"
ON public.sla_policy_targets
FOR UPDATE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
)
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
);

CREATE POLICY "sla_policy_targets_delete"
ON public.sla_policy_targets
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
);

GRANT ALL ON public.sla_policy_targets TO anon, authenticated, service_role;

-- ── 7. reports_overview — read normal target from sla_policy_targets ─────────

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

