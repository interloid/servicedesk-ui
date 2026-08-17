-- =====================================================
-- Notification Preferences
-- =====================================================

create table if not exists public.notification_prefs
(
    id uuid primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    user_id uuid
        not null
        references public.users(id)
        on delete cascade,

    channel_json jsonb
        not null
        default
        jsonb_build_object
        (
            'email',true,
            'in_app',true
        ),

    created_at timestamptz
        default now(),

    updated_at timestamptz
        default now(),

    constraint uq_notification_pref
        unique(tenant_id,user_id)
);

