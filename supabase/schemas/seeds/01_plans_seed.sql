INSERT INTO plans (
    code,
    name,
    price_month,
    seat_limit,
    ticket_limit,
    features_json
)
VALUES
(
    'F-15e70eec-7094-403f-b70e-8126fd7c062a',
    'Free',
    0.00,
    2,
    50,
    '{
        "core_ticketing": true,
        "customer_portal": true,
        "email_notifications": true,
        "sla_policies": 1
    }'::jsonb
),
(
    'P-1PL59890TT146894PNJTO7PI',
    'Pro',
    29.00,
    15,
    999999,
    '{
        "core_ticketing": true,
        "customer_portal": true,
        "email_notifications": true,
        "sla_policies": -1,
        "business_hours": true,
        "saved_shared_views": true,
        "branding": true,
        "priority_support": true
    }'::jsonb
),
(
    'P-3EE87724RE6823443NJTPACY',
    'Business',
    59.00,
    999999,
    999999,
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
    }'::jsonb
);