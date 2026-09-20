-- =====================================================
-- Subscription plans
-- =====================================================
--
-- `code` is the PayPal BILLING PLAN id for a paid plan (Free has no PayPal
-- plan, so it carries a synthetic id).
--
-- EVERY PAID PLAN MUST SIT UNDER ONE PAYPAL PRODUCT.
-- A paid -> paid plan change revises the tenant's existing agreement, and
-- PayPal only revises between plans of the SAME product -- a cross-product
-- revise fails with PLAN_PRODUCT_NOT_COMPATIBLE and the upgrade cannot
-- complete. Pro and Business below are both under PROD-36684612HM716850Y.
--
-- This file only runs on a fresh database (`supabase db reset`). To change a
-- code on a database that already exists, write a migration -- see
-- 20260920160000_update_paypal_plan_codes.sql.

INSERT INTO plans (
    code,
    name,
    description,
    price_month,
    seat_limit,
    ticket_limit,
    storage_limit_mb,
    features_json,
    is_active,
    sort_order
)
VALUES
(
    'F-15e70eec-7094-403f-b70e-8126fd7c062a',
    'Free',
    'For small teams getting started with help desk essentials.',
    0.00,
    2,
    50,
    1024,
    '{
        "core_ticketing": true,
        "customer_portal": true,
        "email_notifications": true,
        "sla_policies": 1
    }'::jsonb,
    true,
    1
),
(
    'P-0HG79944PA599763KNKX3UAI',
    'Pro',
    'For growing teams that need SLA policies, shared views, and reporting.',
    29.00,
    15,
    999999,
    10240,
    '{
        "core_ticketing": true,
        "customer_portal": true,
        "email_notifications": true,
        "sla_policies": -1,
        "business_hours": true,
        "saved_shared_views": true,
        "branding": true,
        "priority_support": true
    }'::jsonb,
    true,
    2
),
(
    'P-9ML37355RU186980YNKX3UNI',
    'Business',
    'Advanced governance, AI automation, and scale for larger teams.',
    59.00,
    100,
    999999,
    51200,
    '{
        "core_ticketing": true,
        "customer_portal": true,
        "email_notifications": true,
        "sla_policies": -1,
        "business_hours": true,
        "saved_shared_views": true,
        "branding": true,
        "priority_support": true,
        "audit_logs": true,
        "advanced_roles": true,
        "ai_automation": true
    }'::jsonb,
    true,
    3
)
-- Re-running the seed refreshes the plan's details instead of failing on the
-- unique code. It cannot rename a code: a changed code has no conflict to
-- resolve and would insert a SECOND row for the same plan, so code changes
-- belong in a migration.
on conflict (code) do update
set name             = excluded.name,
    description      = excluded.description,
    price_month      = excluded.price_month,
    seat_limit       = excluded.seat_limit,
    ticket_limit     = excluded.ticket_limit,
    storage_limit_mb = excluded.storage_limit_mb,
    features_json    = excluded.features_json,
    is_active        = excluded.is_active,
    sort_order       = excluded.sort_order,
    updated_at       = now();