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
-- png / jpeg / gif / webp only
-- =====================================================
--
-- This bucket is public and served from the project's own origin, so anything in
-- it is reachable by anyone who can guess the URL -- and an avatar path is
-- `<user id>.png`, which is not a secret. Restricting the content types is
-- therefore load bearing rather than cosmetic: without it a customer can POST an
-- SVG or an HTML file with the .png extension, and it is served from the same
-- origin as the app with whatever content type it was stored under.
--
-- The four types here are the four the application accepts (AVATAR_MIME_TYPES in
-- src/features/portal/portal.ts). Storage does not check the extension against
-- the content type, so the bucket has to be the backstop for the prepare call.

INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
VALUES (
    'avatars',
    'avatars',
    true,
    5242880,
    '{image/png,image/jpeg,image/gif,image/webp}'
)
ON CONFLICT (id) DO UPDATE
SET allowed_mime_types = EXCLUDED.allowed_mime_types;


-- =====================================================
-- 4. Ticket Attachments
-- Private
-- 20 MB
-- =====================================================
--
-- Was 50 MB here while the application enforced and advertised 20 MB
-- (MAX_ATTACHMENT_BYTES in src/features/portal/portal.ts, and the copy in the
-- attachment picker). The effective limit was whichever was checked first, so the
-- advertised number was simply wrong. 20 MB is the number the product settled
-- on; the bucket now agrees with it instead of the other way round.

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
    20971520
)
ON CONFLICT (id) DO UPDATE
SET file_size_limit = EXCLUDED.file_size_limit;
