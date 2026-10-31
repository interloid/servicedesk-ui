# Code Review Report

- **Date:** 2026-10-30
- **Reviewer:** Claude Code (automated review)
- **Scope:** `src/app`, `src/features/*`, `src/components/shared`, `src/components/marketing`, `src/lib`, `src/hooks`, `src/actions`, `src/service`, `src/config`, `src/types`, `src/proxy.ts` · 342 files (shadcn `src/components/ui` and generated `database.types.ts` skipped; Supabase schema, policies and the access-token hook read where a finding depends on them)
- **Verdict:** NEEDS ATTENTION

---

## Checks run

- `tsc --noEmit` passes.
- `eslint src` passes with no warnings.
- There is one `any`, in `audit.service.ts:326`. It is typed on purpose for PostgREST builder generics and is commented.
- Both `dangerouslySetInnerHTML` uses are safe. `brand-theme.tsx` writes only checked hex colours. The JSON-LD in `app/layout.tsx` escapes `<`.
- No server-only `process.env` value is read in a `"use client"` file.
- The two `<img>` tags (`ticket-detail-view.tsx:186`, `branding-editor.tsx:1311`) show signed or blob URLs, where `next/image` does not fit. Both are commented.
- Many findings from the 2026-10-22 review are now fixed in code: remember-me cookies, the audit insert policy, the R shortcut, the OG-image matcher, the scoped not-found pages and the cancel-page timer. Their rows in that report's table still say `No`.
- Two findings from 2026-10-22 are still open. They are carried forward below as RISK-001 and RISK-002.
- The live migration list could not be read (no permission). Code added for recent migrations falls back safely when a migration is missing, so the pending migrations do not show up as a code finding here.

---

## ⚡ 1. High-Risk Issues (Bugs, Security Leaks, Broken Logic)

- **RISK-001** · `src/features/onboarding/services/onboarding.service.ts:197`
- **What is wrong:** A new signup's "invite your team" step adds any existing account as an `active` member of the new workspace. It does not ask that person, and it does not check whether they already belong to another workspace. The Team page invite does refuse that case (`team.service.ts:555`, "can't join a second one yet").
- **Why it matters:** Anyone who signs up can add a stranger's email to their workspace. That person gets a seat and an unexpected password-reset email. If their only other membership is a portal customer one, the token hook prefers staff memberships (`03_custom_access_token_hook.sql:96`). Their next sign-in then lands them in the stranger's workspace as an agent.
- **Recommendation:** Use the Team page's checks for existing users here: add them as `invited`, not `active`, and refuse anyone with a membership elsewhere.
- **Minimal fix:**

```ts
// before inserting the membership for existingUser
const { count: elsewhere } = await adminSupabase
  .from("memberships")
  .select("id", { count: "exact", head: true })
  .eq("user_id", existingUser.id)
  .neq("tenant_id", provisioned.tenant_id)
  .neq("status", "disabled");

if (elsewhere) {
  invitationResults.push({
    email: inviteEmail,
    status: "failed",
    message: "That person already belongs to another workspace.",
  });
  continue;
}

// ...and insert with status: "invited" instead of "active"
```

- **RISK-002** · `src/features/onboarding/actions/register-actions.ts:12`
- **What is wrong:** `registerOnboardingAction` has no rate limit. `invite_users` has no maximum length (`onboarding.schema.ts:41`). Each call creates an auth user and a tenant, and queues one email per invitee.
- **Why it matters:** A script can call the action in a loop without signing in. Each loop creates junk workspaces and sends email to any addresses it lists. That costs sending quota and puts the sending domain's reputation at risk. Together with RISK-001, it can also flood a real user with reset emails.
- **Recommendation:** Rate-limit the action like the other public actions, and cap `invite_users`.
- **Minimal fix:**

```ts
// register-actions.ts
export async function registerOnboardingAction(payload: RegisterInput) {
  const { allowed } = rateLimit(`signup:${await clientKey()}`, {
    limit: 3,
    windowMs: 60 * 60_000,
  });
  if (!allowed) {
    return { success: false, error: "Too many sign-ups. Try again later." };
  }
  // ...
}

// onboarding.schema.ts
invite_users: z.array(inviteUserSchema).max(20).default([]),
```

- **RISK-003** · `src/hooks/use-unsaved-changes-guard.ts:32`
- **What is wrong:** The unsaved-changes guard only catches clicks on `<a href>` and page unloads. Every in-app `router.push` skips it: `G T`, `G B` and `N` in `global-shortcuts.tsx:62,78`, picking a header search result (`header-search.tsx:150`), and clicking a notification (`notification-menu.tsx:115`). The browser Back button (`popstate`) is not caught either.
- **Why it matters:** An admin halfway through a new SLA policy or a Branding change clicks a notification, or presses `N` after clicking a switch. The page changes at once and the work is lost without a prompt. This is the exact case the guard was added to prevent.
- **Recommendation:** Put the guard's dirty state in a shared context. Have the global shortcuts, header search and notification menu ask it before calling `router.push`, and handle `popstate` in the hook.
- **Minimal fix:**

```ts
// a shared navigation guard, provided by the base layout
export const NavigationGuardContext = createContext<{
  confirm: (href: string) => boolean; // false = held, popup shown
}>({ confirm: () => true });

// global-shortcuts.tsx / header-search.tsx / notification-menu.tsx
const guard = useContext(NavigationGuardContext);
if (guard.confirm(href)) router.push(href);
```

---

## ⚠️ 2. Medium-Risk Issues (Performance, Anti-patterns, Next.js Violations)

- **RISK-004** · `src/lib/rate-limit.ts:10`
- **What is wrong:** The limiter keeps its counts in a `Map` in server memory. `clientKey()` reads the first `x-forwarded-for` value, which the caller can write.
- **Why it matters:** On serverless hosting each instance has its own `Map`, so a limit of 5 becomes 5 per instance. Behind a proxy that appends to `x-forwarded-for` instead of replacing it, a new fake IP per request skips every limit. That covers guest tickets, sign-in links and password resets, which create rows and send email for signed-out callers.
- **Recommendation:** Store the counts somewhere shared (a Postgres table or a KV store), and key on the IP your host guarantees.
- **Minimal fix:**

```ts
// key on the platform-set header first; fall back to the last hop, not the first
const ip =
  requestHeaders.get("x-real-ip") ??
  forwarded?.split(",").at(-1)?.trim() ??
  "unknown";
```

- **RISK-005** · `src/app/(app)/[tenantSlug]/payment/cancel/page.tsx:67`
- **What is wrong:** The 5-second countdown starts at once. It does not wait for `abortPlanSwitchAction` to finish. The success page does wait (`if (checking ...) return;`).
- **Why it matters:** The abort calls an Edge Function, and a cold start can take more than 5 seconds. The user is then sent to the plans page before the restore has finished. That page still shows the pending upgrade, so the user may click "Upgrade" again.
- **Recommendation:** Start the countdown only after the state leaves `"checking"`.
- **Minimal fix:**

```ts
useEffect(() => {
  if (state === "checking") return;
  if (countdown <= 0) {
    router.push(targetRedirectUrl);
    return;
  }
  const timer = setTimeout(() => setCountdown((prev) => prev - 1), 1000);
  return () => clearTimeout(timer);
}, [state, countdown, router, targetRedirectUrl]);
```

- **RISK-006** · `src/features/saved-view/filters.ts:143`
- **What is wrong:** `searchTerm` turns `, ( ) " \` into spaces. It does not escape `%` or `_`. The ticket list and header search both use it.
- **Why it matters:** A search for `Hello, world` becomes `%Hello  world%` and never finds the ticket "Hello, world". `Refund (urgent)` also finds nothing. `50%` acts as a wildcard and returns tickets that only contain "50". The customers and audit searches use `ilikeOrValue`, which handles all of these correctly.
- **Recommendation:** Use `ilikeOrValue` from `src/lib/postgrest.ts` for the ticket search too.
- **Minimal fix:**

```ts
// tickets.service.ts (list search and searchTenantTickets)
const value = ilikeOrValue(query.trim().slice(0, 100));
const clauses = [`subject.ilike.${value}`, `description.ilike.${value}`];
```

- **RISK-007** · `src/components/shared/layout/header-search.tsx:111`
- **What is wrong:** The debounced `searchTicketsAction` call has no `try/catch`. If the request itself fails (network drop, deploy in progress), the promise rejects inside `setTimeout`.
- **Why it matters:** The results stay in `"loading"`. The spinner keeps turning and the panel never shows an error. The rejection also shows up as an unhandled error in Sentry.
- **Recommendation:** Catch the rejection and set the `"error"` state.
- **Minimal fix:**

```ts
timerRef.current = setTimeout(async () => {
  const result = await searchTicketsAction(slug, term).catch(() => ({
    success: false as const,
    error: "Couldn't search tickets. Try again.",
    tickets: [],
  }));
  if (request !== requestRef.current) return;
  // ...
}, SEARCH_DEBOUNCE_MS);
```

- **RISK-008** · `src/features/auth/services/auth.service.ts:680`
- **What is wrong:** The logout audit row uses `findActiveMembership`. That returns the oldest active membership of any role, not the workspace in the session token.
- **Why it matters:** Take an agent who is also an older portal customer of another workspace. Their logout row names the other tenant. The insert policy requires `tenant_id = current_tenant_id()`, so the row is refused and the failure is hidden (`warn` is silent in production). Those logouts never reach the Security tab.
- **Recommendation:** Use the tenant from the session claims, as login does.
- **Minimal fix:**

```ts
const claims = await getTenantClaims(supabase);
if (!claims?.tenantId) return;
await recordAuthEvent(supabase, {
  action: "logout",
  tenantId: claims.tenantId,
  userId: data.user.id,
  email: data.user.email ?? "",
});
```

- **RISK-009** · `src/features/billing/components/billing-dashboard.tsx:178`
- **What is wrong:** The grace-period and scheduled-change dates are formatted with `toLocaleDateString` during render, with no `timeZone`. This is a Client Component, so it renders once on the server (UTC) and again in the browser (the user's time zone).
- **Why it matters:** Take a date stored as midnight UTC. A US user sees "Oct 31" in the browser where the server wrote "Nov 1". React reports a hydration mismatch and re-renders the page on the client. The user can also see the date change on screen.
- **Recommendation:** Format with a fixed `timeZone: "UTC"` (billing dates are UTC), or render it behind `useMounted()` like the ticket views do.
- **Minimal fix:**

```ts
new Date(iso).toLocaleDateString("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
```

---

## 🏗️ 3. Architectural & Cross-File Findings

- **RISK-010** · Affected files: `src/features/saved-view/filters.ts`, `src/lib/postgrest.ts`, `src/features/portal/services/portal.service.ts`
- **What is wrong:** There are three helpers for putting a search term into a PostgREST `or=` filter: `searchTerm`, `ilikeOrValue` and `likePatternValue`. Each escapes differently. Only `likePatternValue` escapes `*`.
- **Why it matters:** RISK-006 comes from this split. A fix to one helper does not reach the others, so the same text gives different results on different screens.
- **Recommendation:** Keep one helper in `src/lib/postgrest.ts`, with the `*` handling from the portal's version, and delete the other two.

- **RISK-011** · Affected files: `src/lib/rate-limit.ts`, `src/lib/request-context.ts`, `src/features/auth/services/auth.service.ts`
- **What is wrong:** The client IP is read from headers in three places: `clientKey`, `requestClientInfo` and `clientIp`. The fallback rules differ slightly.
- **Why it matters:** The rate limiter and the audit log can disagree on who the caller was. Fixing RISK-004 means changing all three, and one is easy to miss.
- **Recommendation:** Keep `requestClientInfo()` and have the other two call it.

- **RISK-012** · Affected files: `src/proxy.ts`, `src/lib/supabase/server.ts`
- **What is wrong:** Auth cookies are written with different options in each file. The proxy always adds `AUTH_COOKIE_DOMAIN` and forces `secure`. The server client adds the domain only when `NODE_ENV === "production"` and prefers the library's own `secure`. The `IS_HTTPS` check is also written twice.
- **Why it matters:** Take a staging build on a real subdomain host with `NODE_ENV` not set to production. There the proxy writes domain cookies and Server Actions write host-only cookies with the same name. The browser keeps both, and sign-out clears only one, so the user can seem to stay signed in.
- **Recommendation:** Move the cookie options into one helper in `remember.ts`, which the proxy can already import, and use it in both files.

- **RISK-013** · Affected files: `src/features/team/services/team.service.ts`, `src/features/onboarding/services/onboarding.service.ts`, `src/features/customers/services/customer-invite.service.ts`
- **What is wrong:** There are three separate "invite a person" flows. Each repeats the lookup of the user, the membership checks, account creation and the email queueing. The rules have already drifted apart: only the Team flow blocks a second workspace.
- **Why it matters:** RISK-001 is a direct result. A new rule, such as seat limits or a revoked-invite check, has to be added in three places.
- **Recommendation:** Extract one staff-invite function from `team.service.ts` and have signup call it for each invitee.

---

## 🧪 4. Required Test Cases

- **RISK-001** — Sign up a new workspace and invite the email of a user who is an active agent elsewhere. The result should be `failed`, and no membership row should exist for that user in the new tenant.
- **RISK-001** — Sign up and invite the email of a user whose only membership is a portal customer one. Then sign that user in. Their token's `tenant_slug` should still be the portal tenant, and they should not see an agent dashboard.
- **RISK-002** — Call `registerOnboardingAction` four times from one IP within an hour. The fourth call should return the rate-limit error, and no fourth tenant should be created.
- **RISK-002** — Call it with 500 `invite_users`. It should fail validation, with no auth user created and no email queued.
- **RISK-003** — Change a field in the SLA editor, then press `G` then `T` with focus on the page body. The unsaved-changes popup should appear, and the URL should not change until "Leave" is clicked.
- **RISK-003** — Change a Branding field, then click a notification in the bell and press the browser Back button. Each should open the popup, and "Stay" should keep the edits in the form.

---

## 🏁 5. Verdict

**NEEDS ATTENTION** — The codebase is in good shape. Types and lint are clean, server actions validate input and check roles, RLS backs up every write, and most of the last review's high-risk items are fixed. What remains is concentrated in signup. It can still add strangers to a workspace and can be called without limit, and the in-memory rate limiter is weaker than it looks. **Fix first:** RISK-001 together with RISK-002, by sending signup invites through the Team page's invite rules and rate-limiting the signup action.

---

## 📋 6. Risk Tracking Table

| Risk ID  | Priority | Risk (Short Description)                       | File                                                                     | Completed | Reason if Not Completed                                                                                                                                                                                             |
| -------- | -------- | ---------------------------------------------- | ------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RISK-001 | High     | Signup invites add strangers as active members | `src/features/onboarding/services/onboarding.service.ts`                 | Yes       | Signup now calls `addInvitedStaffMember` (the Team page's invite): `invited` only, refused when the person belongs to another workspace                                                                             |
| RISK-002 | High     | Signup unthrottled, invite list unbounded      | `src/features/onboarding/actions/register-actions.ts`                    | Yes       | `signup:` rate limit (3/hour per IP) in `registerOnboardingAction`; `invite_users` capped at 20 in the schema and the wizard                                                                                        |
| RISK-003 | High     | Unsaved-changes guard skipped by router.push   | `src/hooks/use-unsaved-changes-guard.ts`                                 | Yes       | `confirmNavigation(href)` in the guard hook, used by the shortcuts, header search and bell; Back is held with a history sentinel                                                                                    |
| RISK-004 | Medium   | Rate limiter per-instance, spoofable IP key    | `src/lib/rate-limit.ts`                                                  | Yes       | Counts in `rate_limit_buckets` via atomic `rate_limit_hit` RPC (migration 20261031120000, pending on live; falls back to the in-memory map until applied); IP from `x-real-ip`, else the last `x-forwarded-for` hop |
| RISK-005 | Medium   | Cancel page redirects before restore finishes  | `src/app/(app)/[tenantSlug]/payment/cancel/page.tsx`                     | Yes       | Countdown waits until the abort leaves `checking`                                                                                                                                                                   |
| RISK-006 | Medium   | Ticket search breaks on commas, brackets, %    | `src/features/saved-view/filters.ts`                                     | Yes       | Ticket list, header and requester searches use `ilikeOrValue`                                                                                                                                                       |
| RISK-007 | Medium   | Header search spinner sticks on failure        | `src/components/shared/layout/header-search.tsx`                         | Yes       | Rejected search request now ends in the `error` state                                                                                                                                                               |
| RISK-008 | Medium   | Logout audit uses wrong workspace              | `src/features/auth/services/auth.service.ts`                             | Yes       | Logout audit uses the session token's `tenant_id`; `findActiveMembership` removed (unused)                                                                                                                          |
| RISK-009 | Medium   | Billing dates cause hydration mismatch         | `src/features/billing/components/billing-dashboard.tsx`                  | Yes       | Both dates formatted with `timeZone: "UTC"`, like the renewal date                                                                                                                                                  |
| RISK-010 | Low      | Three different search-escaping helpers        | `filters.ts`, `postgrest.ts`, `portal.service.ts`                        | Yes       | `searchTerm` and `likePatternValue` deleted; `ilikeOrValue` sends `*` as `_` (PostgREST rewrites any `*`, escaped or not)                                                                                           |
| RISK-011 | Low      | Client IP read three different ways            | `rate-limit.ts`, `request-context.ts`, `auth.service.ts`                 | Yes       | `clientKey` and `clientIp` both read `requestClientInfo()`                                                                                                                                                          |
| RISK-012 | Low      | Auth cookie options differ proxy vs server     | `src/proxy.ts`, `src/lib/supabase/server.ts`                             | Yes       | One `AUTH_COOKIE_SCOPE` in `remember.ts`, used by the proxy and the server client                                                                                                                                   |
| RISK-013 | Low      | Three invite flows with drifting rules         | `team.service.ts`, `onboarding.service.ts`, `customer-invite.service.ts` | Yes       | Staff invites share `addInvitedStaffMember` (Team + signup); customer invites stay separate (different membership role and email)                                                                                   |

> Update the **Completed** column as you fix each item. If a risk will not be fixed, replace `_Pending_` with the reason (for example: "Deferred to Q3 — requires auth refactor" or "Accepted risk — internal admin page only").
