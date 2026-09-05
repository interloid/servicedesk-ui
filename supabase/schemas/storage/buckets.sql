-- =====================================================
-- File: buckets.sql
-- Description: Supabase Storage Buckets
-- =====================================================


-- =====================================================
-- 1. Invoices
-- Private
-- 10 MB
-- =====================================================

INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit
)
VALUES (
    'invoices',
    'invoices',
    false,
    10485760
)
ON CONFLICT (id) DO NOTHING;


-- =====================================================
-- 2. Customer Files
-- Private
-- 20 MB
-- =====================================================

INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit
)
VALUES (
    'customer-files',
    'customer-files',
    false,
    20971520
)
ON CONFLICT (id) DO NOTHING;


-- =====================================================
-- 3. Avatars
-- Public
-- 5 MB
-- =====================================================

INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit
)
VALUES (
    'avatars',
    'avatars',
    true,
    5242880
)
ON CONFLICT (id) DO NOTHING;


-- =====================================================
-- 4. Ticket Attachments
-- Private
-- 50 MB
-- =====================================================

INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit
)
VALUES (
    'ticket-attachments',
    'ticket-attachments',
    false,
    52428800
)
ON CONFLICT (id) DO NOTHING;