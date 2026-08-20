# Code Review — PR #2 `authentication` → `main`

| | |
|---|---|
| **Repository** | `interloid/servicedesk-ui` |
| **Pull request** | #2 — `authentication` → `main` |
| **Reviewed commit** | `0ede68d` — *setup form to remove default value and update reset password code* |
| **Scope** | 173 files changed, +18,156 / −302 |
| **Review date** | 2026-08-20 |
| **Verdict** | 🔴 **Not production-ready** |

**Summary:** the feature set is broad and largely well-structured, but four P0 defects break the core flows this PR exists to deliver. One of them (`custom_access_token_hook` declared `STABLE` while performing an `UPDATE`) makes **login fail for every user with a membership** the moment the migration is applied. The tenant password-reset flow always emails the wrong workspace, and the tenant login form locks the password field after a single failed attempt. None of these would survive a first smoke test against a seeded database, so the immediate ask is a manual end-to-end pass of signup → login → reset → invite before the next review round.

**Build health**

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ passes clean |
| `eslint src` | ❌ **3 errors, 10 warnings** — would fail a lint gate |

ESLint errors: `@typescript-eslint/no-explicit-any` at `src/features/onboarding/services/onboarding.service.ts:199` and `:298`; `react-hooks/set-state-in-effect` at `src/hooks/use-mobile.ts:14`. Note that ESLint independently flags P0-2 below as unused parameters at `src/features/auth/actions.ts:187-188` — the linter already caught that bug.

---

## P0 — Blockers (must fix before merge)

### P0-1 · Auth hook is `STABLE` but writes — no one can log in
**`supabase/migrations/20260812060000_membership_activate_on_login.sql:26`**
(same defect in `supabase/schemas/functions/03_custom_access_token_hook.sql:13`)

`custom_access_token_hook` is declared `STABLE` yet executes an `UPDATE` to activate the membership. Postgres refuses writes inside a non-volatile function and raises `0A000 — cannot execute UPDATE in a read-only transaction` on **every token issuance**. Any user who has a membership row is locked out of the product entirely.

**Fix:** declare the function `VOLATILE` (the default) in both the migration and the schema file. Keep `SECURITY DEFINER` and the existing `search_path` pin. Re-apply against a scratch database and confirm a real sign-in succeeds — this cannot be verified by type-checking alone.

### P0-2 · Tenant password reset always emails the wrong workspace
**`src/features/auth/actions.ts:199`** → **`src/features/auth/services/auth.service.ts:306-308`**

`resetTenantPasswordAction` accepts `tenant` / `slug` parameters but never forwards them to the service. The service therefore hits its fallback, a hardcoded `slug = "converse"`, and builds the redirect URL for that workspace. Every tenant other than `converse` receives a reset link pointing at someone else's portal — the link either 404s or lands the user in the wrong tenant's context.

**Fix:** thread the tenant slug from the action into the service call, and remove the `"converse"` fallback. A missing slug should be a hard error, not a silent default to a specific customer's workspace.

### P0-3 · Forgot-password form reads a route param that does not exist
**`src/features/auth/components/foget-tenant-password-form.tsx:42`**

The component reads `params.slug`, but the route segment is `[tenantSlug]`. `params.slug` is always `undefined`, so the value degrades to the same `"converse"` fallback as P0-2 — this is the second, independent path to the identical bug.

**Fix:** read `params.tenantSlug`. Worth grepping the tree for other `params.slug` reads under `[tenantSlug]` routes. (Also note the filename typo: `foget-` → `forgot-`.)

### P0-4 · One wrong password permanently disables the password field
**`src/features/auth/components/tenant-login-form.tsx:150`**

The password `<Input>` sets `disabled` whenever a root-level form error is present. After a single failed sign-in the root error is set, the field goes disabled, and the user cannot retype their password without a full page reload. This is the most likely path through the login screen and it dead-ends.

**Fix:** gate `disabled` on the submission-pending state only (`isSubmitting` / `isPending`), never on error state.

---

## P1 — High (data integrity and access control)

### P1-1 · Invited members are created with an invalid role and the error is swallowed
**`src/features/onboarding/services/onboarding.service.ts:247`**

Invitees are inserted with role `"admin"`, which is not a member of the `membership_role` enum, so the insert always fails. The returned error is discarded rather than checked, so the flow reports success: the invitee receives an invitation email but has no membership and cannot access the tenant.

**Fix:** use a valid enum value (`owner` / `member` / whatever the schema defines), and check the insert error before sending the invitation email — never send the email if the membership write failed.

### P1-2 · Seven-step tenant provisioning with no transaction or rollback
**`src/features/onboarding/services/onboarding.service.ts:101`**

Provisioning performs seven sequential writes (user, tenant, membership, subscription, …) with no transaction and no compensating cleanup. A failure at step 5 leaves an orphaned tenant and subscription behind, and — because both the slug and the email are now taken — the customer can neither retry with the same details nor register at all. This is unrecoverable without manual database surgery.

**Fix:** move provisioning into a single Postgres function (`SECURITY DEFINER`, one transaction) so it commits or rolls back atomically. If that is too large a change for this PR, add explicit compensating deletes on each failure path and make the failure message actionable.

### P1-3 · Unauthenticated, unrate-limited account-enumeration oracle
**`src/features/onboarding/register-actions.ts:52`**

`checkEmailTenantAction` is a public server action that performs a **service-role** lookup by email with no authentication and no rate limiting. It returns a clean yes/no signal for "does this email have an account", which is a textbook enumeration primitive against the full user table.

**Fix:** rate-limit per IP, and return a uniform response that does not distinguish registered from unregistered addresses. If the UX genuinely needs the distinction, move the check behind the signup POST itself rather than exposing it as a standalone probe.

### P1-4 · Duplicate-email precheck can never match
**`src/features/onboarding/services/onboarding.service.ts:36`**

The precheck queries `users` as the anon role, but the `users_select` RLS policy is `TO authenticated`. The query is always filtered to zero rows, so the duplicate check silently passes for every email and the real failure surfaces later, mid-provisioning — which is exactly the unrecoverable state described in P1-2.

**Fix:** perform the check with an appropriately privileged client (rate-limited, per P1-3), or drop the precheck and rely on the unique constraint with a properly handled error.

---

## P2 — Medium (broken routing, wrong data on screen)

### P2-1 · Plan and seat counts render as "Free · 0 seats" for every tenant
**`src/lib/identity.ts:97`**

The embedded `plans` relation is many-to-one and comes back as an object, but the code casts it to an array and indexes `[0]`, which yields `undefined`. Every tenant falls through to the default and displays "Free plan · 0 seats" regardless of its actual subscription.

**Fix:** treat the embedded row as an object. Prefer generated Supabase types over a hand-written cast so this mismatch fails at compile time.

### P2-2 · Proxy routes on a claim the auth hook never issues
**`src/proxy.ts:218`**

Routing decisions read `claims.tenant_slug`, but `custom_access_token_hook` never adds that claim to the token. The value is always `undefined`, so an authenticated user hitting `/tickets` gets a 404 instead of being redirected into their tenant.

**Fix:** either emit `tenant_slug` from the auth hook (while fixing P0-1) or resolve the tenant in the proxy from a source that actually exists. Keep one source of truth for tenant resolution.

### P2-3 · Tenant mismatch guard is skipped in path-based routing
**`src/app/(app)/tenant/[tenantSlug]/(base-layout)/layout.tsx:12`**

`getShellIdentity()` resolves the tenant from the host only and ignores the `[tenantSlug]` URL segment. Under path-based routing the mismatch check never fires, so tenant A's shell — its name, branding, and navigation — renders under tenant B's URL. The data queries are still RLS-scoped, so this is a confusing-and-wrong UI rather than a data leak, but it reads as one to a customer.

**Fix:** pass the URL tenant into the identity resolution and fail closed when it disagrees with the session's tenant.

### P2-4 · Auth callback error path 404s
**`src/app/(app)/tenant/[tenantSlug]/auth/callback/route.ts:67`**

`tenantPath()` is applied twice on the missing-code branch, producing `/tenant/x/tenant/x/login`. A user who hits the callback without a code lands on a 404 instead of the login page — precisely when they most need a usable error path.

**Fix:** remove the inner `tenantPath()` call.

### P2-5 · Sidebar builds links from a display name instead of a slug
**`src/components/shared/layout/app-sidebar.tsx:77`**

The slug fallback chain tries `identity?.org.name` — a human-readable display name — *before* the pathname-derived slug. For a tenant named "Northwind Support" this generates `/tenant/Northwind%20Support/...`, which does not resolve.

**Fix:** reorder the fallback to prefer the pathname-derived slug, and never fall back to a display name for URL construction.

### P2-6 · Reset-password error renders as unstyled bare text
**`src/app/(app)/tenant/[tenantSlug]/reset-password/page.tsx:116`**

A JSX operator-precedence bug means the auth error escapes its intended destructive `Alert` and renders as plain unstyled text next to the form.

**Fix:** parenthesize the conditional so the whole `Alert` is the rendered branch.

### P2-7 · Header title is always "Dashboard"
**`src/lib/nav.ts:81`**

`findActiveNavItem` compares unprefixed hrefs (`/tickets`) against tenant-prefixed pathnames (`/tenant/acme/tickets`), so nothing ever matches and the page header falls back to "Dashboard" on every route.

**Fix:** normalize the pathname (strip the tenant prefix) before matching, or prefix the nav hrefs consistently at construction time.

---

## P3 — Low (hygiene, cleanup, config)

- **Dead code shipped.** `src/features/auth/store/signup-draft.ts`, `src/lib/timezones.ts`, `src/schemas/register.ts`, and `recordAuthEvent` / `recordLogoutAttempt` (`auth.service.ts:439-487`) are all unreferenced. Notably `signup-draft.ts` writes the **plaintext signup password to `sessionStorage`** — even unused, this should not be in the tree, and would be a genuine finding if anything ever imported it. Delete it.
- **Reserved slugs are not rejected at registration.** A tenant can register as `www`, `app`, `api`, etc. `tenantLabelFromHost` refuses to resolve those, so the resulting portal is permanently unreachable. Add a denylist to the registration schema.
- **`.env.example` does not match the code.** `NEXT_PUBLIC_SITE_URL` is duplicated, and `AUTH_COOKIE_DOMAIN`, `SUBDOMAIN_ROUTING_AVAILABLE`, `PORTAL_BASE_DOMAIN`, and `SESSION_SECRET` are documented but never read anywhere. Either wire them up or remove them — an env file that lies costs the next person a deployment.
- **Notifications are mock data behind a live-looking UI.** `src/lib/notifications.ts` is a hardcoded array rendered under a functional-looking bell menu. Either hide the control or label it clearly until it is backed by real data.
- **"Keep me signed in" does nothing.** The checkbox is collected and then never affects session persistence.
- **Lint errors listed under *Build health* above** — two `any` escapes in `onboarding.service.ts` and a `set-state-in-effect` violation in `use-mobile.ts`.

---

## Suggested order of work

1. **P0-1** first — until the auth hook is `VOLATILE`, nothing downstream can be tested at all.
2. **P0-2 / P0-3** together — same bug, two entry points; fix both and delete the `"converse"` fallback so it cannot come back a third time.
3. **P0-4** — one-line change, unblocks manual testing of the login screen.
4. **P1-1 / P1-2** — invite and provisioning correctness; P1-2 is the largest single piece of work here and deserves its own commit.
5. **P1-3 / P1-4** — the enumeration endpoint and the RLS precheck are best fixed in one pass, since the fix for one shapes the other.
6. **P2s** — mostly small and independent; P2-2 pairs naturally with P0-1 since both touch the auth hook.
7. **P3** — cleanup pass before merge; the lint errors should be a gate in CI.

**Re-review checklist:** once P0s and P1s land, please run a manual end-to-end pass against a seeded database — register a new tenant, log in, log out, reset the password from the tenant portal, invite a member, and accept the invite — and note the results on the PR. Type-checking passes today on code that cannot log a user in, so green `tsc` is not sufficient evidence for this change set.
