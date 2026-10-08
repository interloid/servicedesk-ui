-- ==========================================================
-- File: 03_tenants.sql
-- ==========================================================

create table if not exists public.tenants
(
    id uuid primary key
        default gen_random_uuid(),

    name text
        not null,

    slug text
        not null
        unique,

    status tenant_status
        not null
        default 'active',

    plan_id uuid
        not null
        references public.plans(id),

    branding_json jsonb
        not null
        default '{}'::jsonb,

    -- Days a ticket may sit in Resolved before sla_tick() closes it; 0 is off.
    auto_close_after_days integer
        not null
        default 4
        constraint chk_tenants_auto_close_after_days
            check (auto_close_after_days between 0 and 90),

    created_at timestamptz
        not null
        default now(),

    updated_at timestamptz
        not null
        default now()
);

comment on table public.tenants is
'Root tenant record';

------------------------------------------------------------
-- Indexes
------------------------------------------------------------

create unique index if not exists idx_tenant_slug
on public.tenants(slug);

create index if not exists idx_tenant_status
on public.tenants(status);

create index if not exists idx_tenant_plan
on public.tenants(plan_id);

------------------------------------------------------------
-- Slug shape
-- ------------------------------------------------------------
--
-- A slug is a DNS label: lowercase alphanumerics and hyphens, no leading or
-- trailing hyphen, 63 characters at most. It is the subdomain a workspace is
-- reached on (SUBDOMAIN_LABEL in src/lib/tenancy.ts), and the two copies of that
-- rule had drifted into checking only the shape in the app and only uniqueness
-- in the database -- so provision_tenant, which is SECURITY DEFINER and called
-- with a slug straight from a form, was the only thing standing between a
-- workspace name and a URL that does not resolve.
--
-- Matched against the app's rule rather than replacing it: same expression, and
-- the app still needs its own copy to fail fast in the form.

alter table public.tenants
    add constraint tenants_slug_is_dns_label
    check (
        slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
    ) not valid;

-- NOT VALID on purpose: the constraint applies to every new and updated row
-- immediately, and skips re-checking rows that already exist. A workspace created
-- before this rule that squats a reserved label keeps working -- renaming it is a
-- product decision with a live URL attached, not something a migration should do
-- behind the owner's back -- and it starts being checked the moment it is renamed.

alter table public.tenants
    add constraint tenants_slug_not_reserved
    check (
        slug <> all (array[
            'www',
            'app',
            'api',
            'admin',
            'auth',
            'static',
            'assets',
            'cdn',
            'mail',
            'login',
            'signup',
            'setup',
            'contact-sales',
            'forgot-password',
            'reset-password',
            'tickets',
            'views',
            'customers',
            'reports',
            'settings',
            'account',
            'billing',
            'plans',
            'payment',
            'sla',
            'kb',
            'macros',
            'unauthorized',
            'portal'
        ])
    ) not valid;

comment on constraint tenants_slug_is_dns_label on public.tenants is
'The workspace address is a DNS label, as SUBDOMAIN_LABEL in src/lib/tenancy.ts defines it. NOT VALID: enforced for new and updated rows only, so an existing address is never rewritten by a migration.';

comment on constraint tenants_slug_not_reserved on public.tenants is
'Reserved labels are the app''s own paths (RESERVED_LABELS in src/lib/tenancy.ts). A workspace on one of them shadows a central route -- a tenant called "portal" takes /portal/requests for its own queue and makes its own portal unreachable. NOT VALID for the same reason as tenants_slug_is_dns_label.';

