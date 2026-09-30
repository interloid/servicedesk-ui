-- ==========================================================
-- Give the "Set a password?" offer back to customers who never took it
-- ==========================================================
--
-- 20260908224500 added portal_password_prompted_at and backfilled it from
-- portal_last_login_at, reasoning that anyone who had already reached the
-- portal had seen the screen at least once under the old routing.
--
-- That was wrong twice over:
--
--   * A customer who HAS a password is never routed to the screen anyway --
--     the step is chosen on `not has_password` first -- so stamping them
--     changed nothing.
--   * A customer who has NO password was, under the old routing, asked on
--     every single sign-in and never answered. Stamping them retired an offer
--     they had never accepted: they now go straight from the email link to the
--     welcome wizard and can never reach the password screen from sign-in.
--
-- The second case is the one that showed up in testing. Undo it for exactly
-- the rows the backfill touched.

update public.customers c
set portal_password_prompted_at = null,
    updated_at                  = now()
from auth.users u
where c.portal_user_id = u.id
  -- What the backfill wrote, to the microsecond. A stamp from the application
  -- is taken at routing time, strictly after portal_link_user writes the login
  -- timestamp, so a genuine one never compares equal here.
  and c.portal_password_prompted_at = c.portal_last_login_at
  and coalesce(u.encrypted_password, '') = '';
