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
    'P-1PL59890TT146894PNJTO7PI',
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
    'P-3EE87724RE6823443NJTPACY',
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
);