-- =====================================================
-- File: 02_timezones.sql
-- Description: Master Time Zones
-- =====================================================

CREATE TABLE IF NOT EXISTS public.timezones
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    code TEXT NOT NULL UNIQUE,

    display_name TEXT NOT NULL,

    country TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_timezone_code
        CHECK (length(code) > 0)
);

COMMENT ON TABLE public.timezones IS
'Master catalog of IANA time zones.';

COMMENT ON COLUMN public.timezones.code IS
'IANA timezone identifier (e.g. Asia/Kolkata).';

COMMENT ON COLUMN public.timezones.display_name IS
'Human-readable timezone name.';