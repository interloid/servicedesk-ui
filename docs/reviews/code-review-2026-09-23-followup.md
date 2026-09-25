# Code Review Report — Follow-up

- **Date:** 2026-09-23
- **Reviewer:** Claude Code (automated review)
- **Scope:** second pass over the Team & roles feature after the fixes in `code-review-2026-09-23.md`: `src/features/team/`, `src/lib/identity.ts`, `src/app/(app)/[tenantSlug]/(base-layout)/settings/team/`, `supabase/schemas/functions/`, `supabase/migrations/20260821103013_*`, `supabase/config.toml`
- **Verdict:** NEEDS ATTENTION _(12 of 13 fixed on 2026-09-23; RISK-017 fixed in the app, database half deferred — see the tracking table)_

---

## ⚡ 1. High-Risk Issues

### RISK-014 · `team.service.ts` inviteMember, `invite-member-modal.tsx`

A Manager could invite someone as Tenant Admin (privilege escalation: invite a second address you own, accept, and you control billing, team and settings).

**Fix:** `inviteMember` refuses Tenant Admin and Billing Admin unless the caller is a Tenant Admin (`ADMIN_ONLY_INVITE_ROLES`, 403 `action-not-allowed`). The dialog takes `callerRole` and hides those roles from Managers.

### RISK-015 · `team.service.ts` changeMemberStatus

"Activate member" skipped the seat limit, so disable → invite → re-enable went past the plan's seats.

**Fix:** when switching a **disabled** member to Active, the same `hasSeatLeft(getTeamSeats())` check `inviteMember` runs is applied first (409 `seat-limit-reached`). The RISK-019 trigger enforces the same rule under a lock.

### RISK-016 · `team.service.ts` inviteMember, access-token hook

The hook picks one membership per user (active first), so someone active in workspace A could never land in workspace B; the invite stayed "Invited" and held a seat forever.

**Fix (stop-gap, as recommended):** before anything is created or mailed, `inviteMember` refuses an address that has a non-disabled membership in another workspace: "That person already belongs to another workspace and can't join a second one yet." Disabled memberships don't count because the hook never picks them. A real fix needs a workspace switch the hook can read — not in scope.

### RISK-017 · `src/lib/identity.ts`, `team.service.ts`, RLS helpers

Removal, deactivation and demotion only took effect when the target's token refreshed (up to `jwt_expiry` = 1 h).

**Fix (app layer):**

- `getActorOrNull` (every team read and action) now reads the **live** membership row with the admin client (`status = 'active'`), and takes the role from it rather than the `tenant_role` claim. A removed/disabled member is refused; a demoted admin loses admin actions on their very next call.
- `getShellIdentity` (the `(base-layout)` layout, i.e. every app page) does the same check and uses the live role, so the removed person's next page load is a 404 and a demoted user's nav/route guard reflect the new role immediately.
- Copy no longer promises more than is true: the remove dialog says "They will lose access to this workspace" (not "immediately"), and the toasts no longer claim the person "can no longer sign in".

**Not done (deferred):** `current_tenant_id()` / `current_tenant_role()` still read the JWT, so a removed member who queries Supabase **directly** with their old token keeps RLS access until it expires. 74 policy call sites use these helpers unwrapped, so making them read `memberships` means a per-row lookup on every tenant table; that needs its own change (wrap calls in `(select …)`, index check, load test) rather than a review fix.

---

## ⚠️ 2. Medium-Risk Issues

### RISK-018 · `team.service.ts` getActorOrNull

`cache()` was keyed on the Supabase client, and every `createSupabaseServerClient()` returns a new object, so it never hit (RISK-005 was marked fixed but did nothing).

**Fix:** `getActorOrNull` takes no arguments and creates its own client, so one render resolves the actor once. `requireActor()` likewise.

### RISK-019 · concurrent invites exceed the seat limit

**Fix:** new `BEFORE INSERT OR UPDATE OF role, status, tenant_id` trigger `enforce_team_seat_limit` on `memberships`. It locks the tenant row (`FOR UPDATE`), resolves the limit exactly like `getTeamSeats()` (current active/trialing subscription's `plans.seat_limit`, else Free's 2, `0` = unlimited), counts non-disabled staff seats, and raises SQLSTATE `TS409`. Updates that don't take a new seat (role change, invite accepted by the hook) pass straight through. `team.service.ts` maps `TS409` to `seat-limit-reached` with the usual message.

Files: `supabase/schemas/functions/11_enforce_team_seat_limit.sql`, `supabase/schemas/triggers/memberships_seat_limit.sql`, migration `supabase/migrations/20260923140000_team_seat_limit_trigger.sql`. Parsed with libpg_query; **not yet applied to the hosted project.**

Side effect: onboarding's "invite your agents" step now reports invites beyond the plan's seats as failed instead of silently over-filling the plan (its own copy already says "up to your plan's agent seat allowance").

### RISK-020 · `invite-member-modal.tsx`

Dialog said the invite "expires in 7 days"; `otp_expiry` is 3600 s.

**Fix:** "They'll receive an email invitation. The link expires in 1 hour — use Resend invite if they miss it." Check the hosted project's OTP expiry matches the checked-in 1 hour.

### RISK-021 · `team.service.ts` inviteMember

The invite email for a new address went out before the profile and membership existed.

**Fix:** a new address is created with `admin.auth.admin.createUser({ email_confirm: false })` (no mail), then the profile and membership are written, and the mail is sent **last** for every path. If the profile or membership write fails, the just-created auth user is deleted (cascades to `public.users`), so a retry starts clean and no stray email is sent.

---

## 🏗️ 3. Architectural & Cross-File Findings

### RISK-022 · `types/team.ts` STAFF_ROLES

**Fix:** `platform_admin` removed from `STAFF_ROLES`: no longer on the roster, not counted as a seat, not editable by the customer's Tenant Admin. The DB trigger uses the same role list.

### RISK-023 · `team.service.ts` role/status/remove

**Fix:** `changeMemberRole`, `changeMemberStatus` and `removeMember` add `.in("role", [...STAFF_ROLES])` to their update/delete, so a customer membership id matches nothing ("That member no longer exists").

### RISK-024 · `supabase/schemas/functions/03_custom_access_token_hook.sql`

**Fix:** declarative hook marked `VOLATILE` (with a comment on why) and given the same grants as migration `20260821103013` (`USAGE` on `public`, `SELECT, UPDATE` on `memberships`, `SELECT` on `tenants`). Body was already identical.

### RISK-025 · `change-role-modal.tsx`

**Fix:** "Choose a new role for {email}."

### RISK-026 · `settings/team/page.tsx`

**Fix:** `alternates.canonical` removed (it pointed at a 404).

---

## 🧪 4. Required Test Cases (to run against a database with the migration applied)

- **RISK-014:** as a Manager, `inviteMemberAction({ email, role: "Tenant Admin" })` → `ok: false`, `action-not-allowed`, no membership row. As a Manager with role Agent → succeeds.
- **RISK-015:** 2-seat plan, 2 seats used, 1 disabled member → activate them → `seat-limit-reached`. With 1 seat free → succeeds.
- **RISK-016:** user active in tenant A, invite to tenant B → refused with the "another workspace" message; no auth mail sent.
- **RISK-017:** remove member M while M is signed in → M's next page load 404s and M's next team action is refused. Demote a Tenant Admin → their next `removeMemberAction` fails with `action-not-allowed`.
- **RISK-019:** two invites for the last seat in parallel → exactly one succeeds, the other returns `seat-limit-reached`.
- **RISK-021:** force the membership insert to fail for a new address → no invite email, no auth user left behind.

---

## 📋 6. Risk Tracking Table

| Risk ID  | Priority | Risk (Short Description)                       | File                                                              | Completed | Reason if Not Completed                                                                                                                 |
| -------- | -------- | ---------------------------------------------- | ----------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| RISK-014 | High     | Manager can invite a Tenant Admin              | `src/features/team/services/team.service.ts`                      | Yes       | Fixed 2026-09-23 — server refuses admin-only roles for non-admins; dialog filters them                                                  |
| RISK-015 | High     | Reactivating a member skips seat limit         | `src/features/team/services/team.service.ts`                      | Yes       | Fixed 2026-09-23 — seat check when a disabled member is activated                                                                       |
| RISK-016 | High     | Existing users can never join second workspace | `src/features/team/services/team.service.ts`                      | Yes       | Stop-gap 2026-09-23 — invite refused with a clear message; multi-workspace sessions still to design                                     |
| RISK-017 | High     | Removed members keep access up to 1h           | `src/lib/identity.ts`                                             | Partial   | App layer fixed (live membership in actor + shell, copy corrected); RLS helpers still read the JWT — needs its own perf-reviewed change |
| RISK-018 | Medium   | cache() keyed on new client, never hits        | `src/features/team/services/team.service.ts`                      | Yes       | Fixed 2026-09-23 — argument-free cached getActorOrNull                                                                                  |
| RISK-019 | Medium   | Concurrent invites can exceed seat limit       | `supabase/migrations/20260923140000_team_seat_limit_trigger.sql`  | Yes       | Fixed 2026-09-23 — locking BEFORE trigger; migration not yet applied to hosted DB                                                       |
| RISK-020 | Medium   | Invite says 7 days, expires in 1h              | `src/features/team/components/invite-member-modal.tsx`            | Yes       | Fixed 2026-09-23 — copy says 1 hour + Resend invite                                                                                     |
| RISK-021 | Medium   | Invite mail sent before membership exists      | `src/features/team/services/team.service.ts`                      | Yes       | Fixed 2026-09-23 — createUser without mail, mail last, rollback on failure                                                              |
| RISK-022 | Low      | platform_admin shown as Agent, counts seat     | `src/features/team/types/team.ts`                                 | Yes       | Fixed 2026-09-23 — removed from STAFF_ROLES                                                                                             |
| RISK-023 | Low      | Mutations accept customer membership ids       | `src/features/team/services/team.service.ts`                      | Yes       | Fixed 2026-09-23 — staff-role filter on update/delete                                                                                   |
| RISK-024 | Low      | Declarative hook still STABLE, breaks sign-in  | `supabase/schemas/functions/03_custom_access_token_hook.sql`      | Yes       | Fixed 2026-09-23 — VOLATILE + migration's grants                                                                                        |
| RISK-025 | Low      | Change-role description text is garbled        | `src/features/team/components/change-role-modal.tsx`              | Yes       | Fixed 2026-09-23 — "Choose a new role for …"                                                                                            |
| RISK-026 | Low      | Canonical URL points at a 404                  | `src/app/(app)/[tenantSlug]/(base-layout)/settings/team/page.tsx` | Yes       | Fixed 2026-09-23 — canonical removed                                                                                                    |
