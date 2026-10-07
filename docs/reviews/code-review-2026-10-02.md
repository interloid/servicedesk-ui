# Code Review Report — Follow-up

- **Date:** 2026-10-02
- **Reviewer:** Claude Code (automated review)
- **Scope:** check of the fixes for the 2026-10-01 review of `feature/customer-portal` (RISK-001 to RISK-054), plus a new review of the uncommitted fix diff: `supabase/migrations/20260926*`, `supabase/schemas/**`, `supabase/functions/portal-storage-sweep/`, `supabase/config.toml`, `src/features/portal/`, `src/features/customers/`, `src/app/(app)/[tenantSlug]/portal/`, `src/app/(app)/[tenantSlug]/(base-layout)/customers/`, `src/proxy.ts`, `src/lib/tenancy.ts`, `next.config.ts` · 57 files
- **Verdict:** CRITICAL _(fixes applied on 2026-10-02 — see the Completed column; RISK-022/023/044/048 partly, RISK-033 accepted)_

---

## 0. Status of the 2026-10-01 findings

Of 54 findings, **15 are fixed**, **14 are partly fixed** and **25 are not fixed**.

Two of the ten High findings are still untouched: RISK-006 and RISK-009.

**Most of the database fixes would not take effect.** They live in `20260926120000_portal_rls_hardening.sql`. That migration fails to apply (RISK-055) and runs inside `begin … commit`, so it rolls back completely. Until RISK-055 is fixed, these items are fixed in the code but not in the database: RISK-001, 004, 005, 008 (the DB check), 018, 020 (the bucket limit), 032 and 038.

Checks run: `tsc --noEmit` passes. Prettier passes. ESLint reports 0 errors and 4 warnings, all in `customer-details.tsx` (RISK-065). All new SQL parses with libpg_query. Parsing does not catch RISK-055; a real Postgres (PGlite) does.

| Risk     | Was    | Now    | Evidence                                                                                                                                                                             |
| -------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RISK-001 | High   | Partly | `tickets_update` is staff-only, and reopen and reply go through RPCs. But `tickets_insert` still lets customers set any column (RISK-057). Blocked by RISK-055.                      |
| RISK-002 | High   | Partly | `csat_ratings_guard` sets the agent and locks the score. RISK-057 still lets a customer insert a resolved ticket and rate it, again and again.                                       |
| RISK-003 | High   | Partly | The table policies hide internal-note attachments. The storage half is weak (RISK-056, RISK-062), and the admin signer ignores it (RISK-050).                                        |
| RISK-004 | High   | Fixed  | `customers_update` is staff-only (hardening:183-207). Blocked by RISK-055.                                                                                                           |
| RISK-005 | High   | Partly | The hook now prefers staff memberships, so staff invites work. Nothing writes `preferred_tenant_id`, so a customer of two tenants is still stuck on the older one.                   |
| RISK-006 | High   | No     | `recordPortalAttachments` still has no duplicate or existing-path check. Cleanup still deletes every path the client sent.                                                           |
| RISK-007 | High   | Partly | `%`, `_` and `\` are escaped now. The value is still unquoted, so `,` and `)` still break the filter.                                                                                |
| RISK-008 | High   | Fixed  | `portal` is reserved in `tenancy.ts:90`. The slug check is in hardening:878 (blocked by RISK-055).                                                                                   |
| RISK-009 | High   | No     | `claimInvitedCustomer` still uses `.ilike("email", …)` (`portal.service.ts:621`).                                                                                                    |
| RISK-010 | High   | Fixed  | The profile write now runs after every guard. The code is still unreachable (RISK-043).                                                                                              |
| RISK-011 | Medium | Partly | CSAT RLS, the trigger, the index and the attachment table policies match. The storage update/delete policies differ between `schemas/` and the migration (RISK-056).                 |
| RISK-012 | Medium | Fixed  | All six migrations are now 20260926*, after main's 20260925130000. Their order is still correct.                                                                                     |
| RISK-013 | Medium | Partly | The table policies are back to "any active member". The storage delete policy in `schemas/` still leaves out `agent`, and the migration's version is unscoped (RISK-056).            |
| RISK-014 | Medium | Fixed  | The `updated_at` trigger is switched off around the backfill, and the undo migration is deleted.                                                                                     |
| RISK-015 | Medium | Fixed  | The undo file and the backfill are both removed. This assumes `224500` never ran remotely, which could not be checked.                                                               |
| RISK-016 | Medium | Partly | Zod validation was added, and the update is scoped to `resolved_at`. It still doesn't check that a row was updated. The action is now dead code (RISK-066).                          |
| RISK-017 | Medium | No     | `files` and `uploads` still have no runtime schema. `upload.name` still has no length cap.                                                                                           |
| RISK-018 | Medium | Fixed  | The avatars bucket has `allowed_mime_types` (blocked by RISK-055). A comment says the service reads the stored object back. It doesn't.                                              |
| RISK-019 | Medium | Fixed  | Each signed URL now uses `download: original_filename`.                                                                                                                              |
| RISK-020 | Medium | Partly | The bucket limit is 20 MB, and a daily sweep is scheduled. The sweep deletes nothing (RISK-060). `guard("upload")` still counts calls, not files.                                    |
| RISK-021 | Medium | No     | Agent names still fall back to `row.email` (`portal.service.ts:1494`, `:1506`).                                                                                                      |
| RISK-022 | Medium | Partly | Only `secure_password_change = true` was set in `config.toml`, which covers local only. The hosted project needs the dashboard setting. `setPasswordAction` still has no rate limit. |
| RISK-023 | Medium | No     | Password sign-in still checks `isTeamEmail` before the password (`:451`). The link path still returns a distinct team message.                                                       |
| RISK-024 | Medium | Fixed  | The page now shows fixed messages chosen by an error code. The lookup creates a new crash (RISK-059).                                                                                |
| RISK-025 | Medium | Partly | The stamp moved into `after()`, but it still runs whenever the page renders. Only `loading.tsx` stops a prefetch from triggering it.                                                 |
| RISK-026 | Medium | Partly | `remotePatterns` is now built from `NEXT_PUBLIC_SUPABASE_URL`. There is still no `portal/error.tsx`.                                                                                 |
| RISK-027 | Medium | No     | `getPortalRequest` is not wrapped in `cache()`. The detail page still loads it twice.                                                                                                |
| RISK-028 | Medium | No     | The portal list still has no `id` tie-breaker (`portal.service.ts:1142`).                                                                                                            |
| RISK-029 | Medium | Fixed  | The new `customer_csat` view uses `security_invoker` and is used for both reads.                                                                                                     |
| RISK-030 | Medium | No     | `fetchTenantCustomers` still has no range. Search and paging still run in the browser.                                                                                               |
| RISK-031 | Medium | No     | `loadPortalInvites` still loads every customer membership, and its result is no longer shown (RISK-065).                                                                             |
| RISK-032 | Medium | Fixed  | A guest request against a claimed customer now raises 42501, which the app maps to "Sign in first" (blocked by RISK-055).                                                            |
| RISK-033 | Medium | Partly | The choice is now documented: replies don't reopen resolved tickets. The reply box is still active on them. The RPC behind it is RISK-055.                                           |
| RISK-034 | Medium | Fixed  | The debug logs are removed. `completeLink` signs out on any link failure.                                                                                                            |
| RISK-035 | Medium | No     | There's no `<Suspense key>`. Changing the tab or page still shows the whole `loading.tsx`.                                                                                           |
| RISK-036 | Medium | No     | `brand-theme.tsx` is unchanged.                                                                                                                                                      |
| RISK-037 | Medium | No     | `setup/loading.tsx:47` still uses `key={field.label}` with two `"w-20"` entries.                                                                                                     |
| RISK-038 | Medium | Fixed  | `portal_link_user` requires `email_confirmed_at` (blocked by RISK-055).                                                                                                              |
| RISK-039 | Medium | No     | A failed page query still returns the real `total` (`:1147`).                                                                                                                        |
| RISK-040 | Medium | No     | `portal-requests-list.tsx:84` still compares untrimmed text.                                                                                                                         |
| RISK-041 | Medium | No     | Both copy problems are unchanged.                                                                                                                                                    |
| RISK-042 | Medium | No     | Reopen ignores the RPC's row count. The profile name is still saved before `avatarPath` is checked.                                                                                  |
| RISK-043 | Low    | Partly | `getCustomersAction` was removed. `InviteCustomerModal` and about 300 lines of invite service code are still never imported.                                                         |
| RISK-044 | Low    | No     | There are still three `Pagination` copies, and paths are still built by hand.                                                                                                        |
| RISK-045 | Low    | No     | The upload sequence is still copied into both forms.                                                                                                                                 |
| RISK-046 | Low    | Fixed  | One `redirectStaffHome` helper (`proxy.ts:125`) is used by both branches.                                                                                                            |
| RISK-047 | Low    | No     | Errors still show as both a toast and an inline alert.                                                                                                                               |
| RISK-048 | Low    | No     | The types were hand-edited, not regenerated. They are missing the new RPCs and `preferred_tenant_id`.                                                                                |
| RISK-049 | Low    | No     | Both casts are still there.                                                                                                                                                          |
| RISK-050 | Low    | No     | The admin client still signs every attachment, including internal-note ones. RISK-058 makes this exploitable.                                                                        |
| RISK-051 | Low    | No     | `proxy.ts:204-227` still lets customer sessions through on every central path.                                                                                                       |
| RISK-052 | Low    | No     | `getTenantContext` is still called only to pass `tenantName`, which nothing reads.                                                                                                   |
| RISK-053 | Low    | No     | There's still no UUID check before the queries.                                                                                                                                      |
| RISK-054 | Low    | Fixed  | No dangling references remain, and `triggers/tickets_resolution_stamps.sql` now exists.                                                                                              |

---

## ⚡ 1. High-Risk Issues (Bugs, Security Leaks, Broken Logic)

### RISK-055 · `supabase/migrations/20260926120000_portal_rls_hardening.sql:96-121` (also `supabase/schemas/functions/15_portal.sql:496`)

- **What is wrong:** `portal_reply_bumps_status` is declared `returns integer language sql`, but its last statement is a plain `UPDATE`. Postgres refuses to create it with "return type mismatch in function declared to return integer". This was reproduced in PGlite.
- **Why it matters:** The migration runs inside `begin; … commit;`, so all of it rolls back. None of its RLS, hook, bucket or slug fixes reach the database. `supabase db push` fails. Every portal reply also calls this RPC, so it would fail even if the rest were applied by hand.
- **Recommendation:** Make the function return the row count, the same way `portal_reopen_ticket` does.
- **Minimal fix:**

```sql
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  update public.tickets t set status = 'open'
  where t.id = p_ticket and t.status in ('pending', 'on_hold')
    and exists (select 1 from public.customers c
                where c.id = t.requester_customer_id and c.portal_user_id = p_user_id);
  get diagnostics v_count = row_count;
  return v_count;
end $$;
```

### RISK-056 · `supabase/migrations/20260926120000_portal_rls_hardening.sql:345-372`

- **What is wrong:** The migration recreates the `ticket_attachments_update` and `ticket_attachments_delete` storage policies. Both check only `bucket_id` and `is_active_membership()`. There is no tenant-folder check and no role check. `schemas/policies/storage/ticket_attachments.sql` has the scoped version, so the two don't match.
- **Why it matters:** Any signed-in member of any tenant can delete or overwrite any file in the bucket. Portal customers are members with role `customer`, so this includes customers. Update only checks that the _new_ folder is the user's own tenant. So a customer can move another tenant's file into their own folder and then read it.
- **Recommendation:** Copy the scoped bodies from the schema file into the migration. Restore `agent` to the delete policy's staff list (RISK-013).
- **Minimal fix:**

```sql
using (
  bucket_id = 'ticket-attachments'
  and (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
  and public.current_tenant_role() in ('tenant_admin', 'manager', 'agent', 'billing_admin')
)
```

### RISK-057 · `supabase/schemas/policies/09_tickets.sql:43-60` (`initial_schema.sql:1324`)

- **What is wrong:** The customer branch of `tickets_insert` only checks `requester_customer_id`. A customer can insert a ticket with any `status`, `priority`, `assignee_user_id`, `sla_policy_id` or `first_response_at`. The portal never uses this branch; it creates tickets through the service-role `portal_create_request`.
- **Why it matters:** This reopens RISK-001 and RISK-002. A customer inserts a ticket with `status = 'resolved'` and any agent as assignee. The resolution trigger stamps `resolved_at`, and the customer rates it 1. `csat_ratings_guard` faithfully copies that assignee. The customer can repeat this without limit and without any agent doing anything.
- **Recommendation:** Make `tickets_insert` staff-only, the same way `tickets_update` now is.
- **Minimal fix:**

```sql
-- tickets_insert: delete the `OR requester_customer_id = (…)` branch,
-- in schemas/policies/09_tickets.sql and in the hardening migration.
```

### RISK-058 · `supabase/migrations/20260926090500_scope_attachments_to_portal_customers.sql:146-170` (with `portal.service.ts:1983-2030`)

- **What is wrong:** The update and delete policies on `public.attachments` allow any active member of the tenant, and that now includes customers. The schema comment says customers can't rewrite `storage_path`, but no policy enforces it.
- **Why it matters:** A customer can PATCH an attachment row on their own ticket so that `storage_path` points at another customer's file. `readPortalAttachments` signs `storage_path` with the admin client, so the portal hands back a working download link. That is a file read across customers. A customer can also delete agent attachment rows.
- **Recommendation:** Limit both policies to staff roles, which keeps the rights staff had before this PR.
- **Minimal fix:**

```sql
using (
  tenant_id = public.current_tenant_id()
  and public.current_tenant_role() in ('tenant_admin', 'manager', 'agent', 'billing_admin')
)
-- same for WITH CHECK on update
```

---

## ⚠️ 2. Medium-Risk Issues (Performance, Anti-patterns, Next.js Violations)

### RISK-059 · `src/features/portal/portal.ts:444-457`

- **What is wrong:** `portalLoginError` looks up `?error=` in a plain object literal. `?error=constructor` returns the `Object` function, and `?error=__proto__` returns an object.
- **Why it matters:** The value is passed as `initialError` to the Client Component `PortalSignInForm`. React can't send a function to a Client Component, so the tenant's login page crashes. There is no `portal/error.tsx` (RISK-026), so the root error page shows. Anyone can trigger this with a link.
- **Recommendation:** Only accept the map's own keys.
- **Minimal fix:**

```ts
return code && Object.hasOwn(PORTAL_LOGIN_ERRORS, code)
  ? PORTAL_LOGIN_ERRORS[code]
  : undefined;
```

### RISK-060 · `supabase/functions/portal-storage-sweep/index.ts:98-101`, `:172`

- **What is wrong:** `listRecursive` returns file names relative to the batch folder. The caller then builds `${tenant}/staging/${name}`, which drops the `<batch>/` segment.
- **Why it matters:** `remove()` targets paths that don't exist. Storage doesn't treat a missing path as an error, so the sweep logs "removed N" while deleting nothing. RISK-020's cleanup never happens.
- **Recommendation:** Keep the subfolder in each returned name.
- **Minimal fix:**

```ts
files.push(
  ...(await listRecursive(`${path}/${entry.name}`)).map((e) => ({
    ...e,
    name: `${entry.name}/${e.name}`,
  })),
);
```

### RISK-061 · `supabase/config.toml:203-207`

- **What is wrong:** `password_requirements = "letters_digits"` and `minimum_password_length = 8` apply to every auth flow, not just the portal. The team sign-up schema (`signup-account.ts:11-17`) checks length only.
- **Why it matters:** A team sign-up or password reset like `correcthorse` passes the form, then fails in GoTrue with a generic error. That changes the existing team flow.
- **Recommendation:** Either add the same digit rule to the team schemas, or keep the digit rule in the portal form only.
- **Minimal fix:**

```ts
.regex(/\d/, "Include at least one number")  // signup-account.ts and reset-password.ts
```

### RISK-062 · `supabase/migrations/20260926120000_portal_rls_hardening.sql:285-292`, `:330-337`

- **What is wrong:** The storage rule that hides internal-note files from customers assumes the message id is path segment 3. It also never checks that the message belongs to that ticket. Portal paths are `<tenant>/<ticket>/<file>`, so there is no such segment today.
- **Why it matters:** The day agents upload attachments to internal notes, customers will be able to download them straight from storage. This is not exploitable today.
- **Recommendation:** Decide visibility from the `attachments` row, not from the path.
- **Minimal fix:**

```sql
and exists (select 1 from public.attachments a
  left join public.ticket_messages m on m.id = a.message_id
  where a.storage_path = storage.objects.name
    and (a.message_id is null or m.visibility = 'public'))
```

### RISK-063 · `supabase/schemas/policies/10_ticket_messages.sql` (`ticket_messages_update`)

- **What is wrong:** The customer branch's WITH CHECK doesn't require `ticket_id` to be a ticket the customer owns. The policy predates this PR, but the PR makes it reachable.
- **Why it matters:** A customer who knows another customer's ticket UUID can move their own public message onto it. That injects text into another customer's thread and the agents' view.
- **Recommendation:** Remove customer UPDATE, or reuse the ownership join from the insert policy.
- **Minimal fix:**

```sql
-- drop the customer OR-branch from ticket_messages_update (USING and WITH CHECK)
```

---

## 🏗️ 3. Architectural & Cross-File Findings

### RISK-064 · Affected files: `src/lib/supabase/database.types.ts`, `portal.service.ts:2455-2468`

- **What is wrong:** `portal_reopen_ticket` and `portal_reply_bumps_status` are missing from the generated types. The admin client is untyped, so a wrong RPC name or argument still compiles. That is how RISK-055 got through without a type error. The reopen row count is thrown away.
- **Why it matters:** RPC typos are only caught at runtime. Reopening a stale page still shows "Reopened" (RISK-042).
- **Recommendation:** Regenerate the types from a local database (`supabase gen types --local`). Throw `not_found` when reopen returns 0.

### RISK-065 · Affected files: `src/features/customers/components/customer-details.tsx:39-40, 545, 560`, `customers.service.ts:176-188`

- **What is wrong:** The contact portal badge ("Invited" / "Portal active") was removed, but its inputs were left behind. These are the 4 ESLint warnings. `loadPortalInvites` still runs on every detail view for data nothing shows.
- **Why it matters:** Agents can't see a contact's portal state any more, and the slow query from RISK-031 runs for no reason.
- **Recommendation:** Either restore the badge, or remove the leftover props, imports and `loadPortalInvites` together.

### RISK-066 · Affected files: `src/features/portal/actions/portal.actions.ts:597`, `portal.service.ts` (`addPortalCsatComment`), `portal.schema.ts`

- **What is wrong:** The rewritten CSAT card no longer calls `addCsatCommentAction`.
- **Why it matters:** Unused code is still a public server-action endpoint, and it still has RISK-016's zero-row problem.
- **Recommendation:** Delete the action, the service function and `portalCsatCommentSchema`.

### RISK-067 · Affected files: `supabase/functions/portal-storage-sweep/index.ts:87`, `:142-145`

- **What is wrong:** The `tenants` query has no range, so `max_rows` caps it at 1,000. Each folder listing also reads only one 1,000-entry page.
- **Why it matters:** Once RISK-060 is fixed, tenants beyond row 1,000 are never swept. Neither are files past the first page of a busy prefix.
- **Recommendation:** Page both the query and `list()` with `offset` until a short page comes back.

---

## 🧪 4. Required Test Cases

| Risk ID  | Test                                                                                                      | What it should prove                                                |
| -------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| RISK-055 | `supabase db reset` on a clean local stack                                                                | Every migration applies, and `portal_reply_bumps_status` exists.    |
| RISK-055 | A customer replies on a `pending` ticket through the portal                                               | The ticket becomes `open`, and the reply action returns success.    |
| RISK-056 | Signed in as a customer of tenant A, DELETE a storage object under tenant B's folder                      | 0 objects are removed, and the file still exists.                   |
| RISK-056 | An agent of tenant A deletes an attachment object in tenant A                                             | The delete succeeds, so staff rights are unchanged.                 |
| RISK-057 | Signed in as a customer, POST `/rest/v1/tickets` with `status=resolved` and an `assignee_user_id`         | It is rejected with 42501.                                          |
| RISK-057 | Create a request through the portal UI                                                                    | The ticket is created, so `portal_create_request` still works.      |
| RISK-058 | Signed in as a customer, PATCH an attachment row on their own ticket to another customer's `storage_path` | 0 rows are updated, and the portal shows no link to the other file. |
| RISK-058 | An agent deletes an attachment row                                                                        | The delete succeeds.                                                |

The open High items from 2026-10-01 still need the tests listed in that report: RISK-001, 002, 003, 005, 006, 007 and 009.

---

## 🏁 5. Verdict

**CRITICAL.** The fixes are not complete: 25 of 54 findings are untouched, and two of the ten High findings are still open. The new hardening migration doesn't apply, so the RLS fixes that were written never reach the database. The new storage and attachment policies also open two new cross-customer file holes. Fix RISK-055 first, because it's a one-function change that unblocks all the other database fixes. Then close RISK-056, 057 and 058 before anything else.

---

## 📋 6. Risk Tracking Table

| Risk ID  | Priority | Risk (Short Description)                       | File                                               | Completed | Reason if Not Completed                                                                                                                                                                                            |
| -------- | -------- | ---------------------------------------------- | -------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RISK-001 | High     | Customer can update any ticket column          | `supabase/schemas/policies/09_tickets.sql`         | Yes       | `tickets_update` and `tickets_insert` staff-only (RISK-057); reply/reopen via service-role RPCs. PGlite: customer PATCH/POST refused                                                                               |
| RISK-002 | High     | CSAT ratings forgeable and editable            | `20260926093000_csat_ratings.sql`                  | Yes       | Guard sets agent + locks score; forged resolved tickets closed by RISK-057                                                                                                                                         |
| RISK-003 | High     | Internal-note attachments readable by customer | `20260926090500_scope_attachments…sql`             | Yes       | Table + storage read decided by the attachments row (RISK-062); admin signer is RISK-050 (app side)                                                                                                                |
| RISK-004 | High     | Customer can change own email, hijack requests | `supabase/schemas/policies/06_customers.sql`       | Yes       | Migration now applies (RISK-055 fixed)                                                                                                                                                                             |
| RISK-005 | High     | Single-tenant token breaks multi-tenant users  | `03_custom_access_token_hook.sql`                  | Yes       | Hook prefers `preferred_tenant_id`; written at portal link with the admin client; users can't write it (guard trigger, 42501); clearing it clears app_metadata                                                     |
| RISK-006 | High     | Customer can delete others' attachment files   | `portal.service.ts`                                | Yes       | Duplicate and already-filed paths refused before any write; insert-failure cleanup skips 23505 (2026-10-02)                                                                                                        |
| RISK-007 | High     | Search escaping broken, commas break list      | `portal.service.ts`                                | Yes       | Value now double-quoted, `%` `_` `\` `*` escaped (`likePatternValue`) (2026-10-02)                                                                                                                                 |
| RISK-008 | High     | "portal" not reserved, subdomain portal dead   | `src/lib/tenancy.ts`                               | Yes       | DB slug check applies now (RISK-055 fixed)                                                                                                                                                                         |
| RISK-009 | High     | ilike wildcard claims another customer         | `portal.service.ts`                                | Yes       | Exact `eq` match, oldest unclaimed row claimed by id (2026-10-02)                                                                                                                                                  |
| RISK-010 | High     | Invite overwrites user profile before checks   | `customers.service.ts`                             | Yes       | Invite flow removed — customers have no invite flow (2026-10-02)                                                                                                                                                   |
| RISK-011 | Medium   | Declarative schema missing CSAT RLS            | `supabase/schemas/tables/24_csat_ratings.sql`      | Yes       | `schemas/` storage, attachments, tickets, messages, users trigger and `15_portal.sql` match the migrations                                                                                                         |
| RISK-012 | Medium   | Migrations timestamped before main's           | `supabase/migrations/20260926*`                    | Yes       |                                                                                                                                                                                                                    |
| RISK-013 | Medium   | Attachment policies narrow staff rights        | `20260926090500_scope_attachments…sql`             | Yes       | Table and storage staff rights match main (storage delete is admin/manager on main, kept); customers lose update/delete                                                                                            |
| RISK-014 | Medium   | Backfills rewrite updated_at everywhere        | `20260926093000_csat_ratings.sql`                  | Yes       |                                                                                                                                                                                                                    |
| RISK-015 | Medium   | Migration and its undo shipped together        | `20260926104500_portal_password_prompt.sql`        | Yes       | Assumes 224500 never ran remotely                                                                                                                                                                                  |
| RISK-016 | Medium   | CSAT comment unvalidated, overwrites history   | `portal.actions.ts`                                | Yes       | Action, service and schema deleted with RISK-066; the card sends score and comment together through `submitCsatAction`                                                                                             |
| RISK-017 | Medium   | Upload action inputs not validated             | `portal.actions.ts`                                | Yes       | zod schemas for file descriptors, uploads, avatar path; names capped at 255 (2026-10-02)                                                                                                                           |
| RISK-018 | Medium   | Avatar type trusted from client                | `portal.service.ts`                                | Yes       | Bucket MIME list applies now (RISK-055 fixed). Comment about read-back is app side                                                                                                                                 |
| RISK-019 | Medium   | Signed URLs render uploaded files inline       | `portal.service.ts`                                | Yes       |                                                                                                                                                                                                                    |
| RISK-020 | Medium   | Staged uploads unbounded and never cleaned     | `portal.actions.ts`                                | Yes       | App: limiter counts files; a failed upload set and a refused submit hand their paths to `discardUploadsAction`. DB side: 20 MB bucket; sweep fixed (RISK-060) and paged (RISK-067)                                 |
| RISK-021 | Medium   | Agent email shown to customer                  | `portal.service.ts`                                | Yes       | Agent emails no longer selected; blank name shows "Support" (2026-10-02)                                                                                                                                           |
| RISK-022 | Medium   | Password change without reauth or limit        | `portal.actions.ts`                                | Partly    | Rate limit added (`setPassword`). Reauth relies on `secure_password_change`: must also be enabled in the hosted project's Auth settings                                                                            |
| RISK-023 | Medium   | Staff emails enumerable from portal            | `portal.service.ts`                                | Partly    | Password path checks credentials first; link path answers team addresses like any other and sends nothing. Guest request form still names team addresses (rate-limited 3/15 min)                                   |
| RISK-024 | Medium   | Login shows arbitrary ?error= text             | `portal/login/page.tsx`                            | Yes       | Lookup hardened under RISK-059                                                                                                                                                                                     |
| RISK-025 | Medium   | Welcome page writes during render              | `portal/welcome/page.tsx`                          | Yes       | Stamp moved to `markWelcomeShownAction`, called by the wizard on mount; the page writes nothing (2026-10-02)                                                                                                       |
| RISK-026 | Medium   | Remote logo without remotePatterns             | `portal-shell.tsx`                                 | Yes       | `portal/error.tsx` added (2026-10-02)                                                                                                                                                                              |
| RISK-027 | Medium   | Request detail loaded twice per view           | `portal/requests/[requestId]/page.tsx`             | Yes       | `getPortalRequest` wrapped in `cache()` (2026-10-02)                                                                                                                                                               |
| RISK-028 | Medium   | Pagination order has no tie-breaker            | `portal.service.ts`                                | Yes       | `id` tie-breaker added (2026-10-02)                                                                                                                                                                                |
| RISK-029 | Medium   | CSAT averages wrong past 1000 ratings          | `customers.service.ts`                             | Yes       | `customer_csat` view dropped (not on live); averages from `csat_ratings`, read in 1000-row pages so nothing is truncated (2026-10-02)                                                                              |
| RISK-030 | Medium   | Customer list capped at 1000 rows              | `customers.service.ts`                             | Yes       | Reads `customers` directly (no view). Name/company/added sort and page in SQL; Tickets/Last activity/CSAT sorts read every match in 1000-row pages, sort, then slice (2026-10-02)                                  |
| RISK-031 | Medium   | Detail page loads all tenant memberships       | `customers.service.ts`                             | Yes       | Invite flow removed — customers have no invite flow; `loadPortalInvites` deleted (2026-10-02)                                                                                                                      |
| RISK-032 | Medium   | Guest requests land in claimed customer        | `20260926120000_portal_rls_hardening.sql`          | Yes       | Applies now (RISK-055 fixed)                                                                                                                                                                                       |
| RISK-033 | Medium   | Reply on resolved ticket stays resolved        | `portal.service.ts`                                | Yes       | Accepted risk: replies keep a resolved ticket resolved by design; reopening is the explicit Reopen button                                                                                                          |
| RISK-034 | Medium   | Callback debug logs, session left on failure   | `portal/auth/callback/route.ts`                    | Yes       |                                                                                                                                                                                                                    |
| RISK-035 | Medium   | Overview skeleton flashes on tab switch        | `customers/[customerId]/loading.tsx`               | Yes       | Header and tabs moved to `[customerId]/layout.tsx`; tab body in `<Suspense key={tab-page}>` with a tab-shaped skeleton; `loading.tsx` replaced by `customer-skeletons.tsx` (2026-10-02)                            |
| RISK-036 | Medium   | Brand colours break dark mode                  | `brand-theme.tsx`                                  | Yes       | Text/background and light shades scoped to light mode; dark hover mixes toward white (2026-10-02)                                                                                                                  |
| RISK-037 | Medium   | Duplicate React keys in setup skeleton         | `src/app/(auth)/setup/loading.tsx`                 | Yes       | Index key on the fixed list (2026-10-02)                                                                                                                                                                           |
| RISK-038 | Medium   | Link ignores email confirmation status         | `20260926120000_portal_rls_hardening.sql`          | Yes       | Applies now (RISK-055 fixed)                                                                                                                                                                                       |
| RISK-039 | Medium   | Failed page query shows contradictory counts   | `portal.service.ts`                                | Yes       | Page error now returns total 0 (2026-10-02)                                                                                                                                                                        |
| RISK-040 | Medium   | Search debounce compares untrimmed text        | `portal-requests-list.tsx`                         | Yes       | Compares `term.trim()` (2026-10-02)                                                                                                                                                                                |
| RISK-041 | Medium   | Wrong sign-in copy on two pages                | `portal-check-email.tsx`                           | Yes       | Check-email says any device; password page banner follows `?via=password` (2026-10-02)                                                                                                                             |
| RISK-042 | Medium   | Zero-row updates report success                | `portal.service.ts`                                | Yes       | Avatar path checked before the first write; name update and reopen both check a row changed (2026-10-02)                                                                                                           |
| RISK-043 | Low      | Invite flow is unreachable dead code           | `invite-customer-modal.tsx`                        | Yes       | Invite flow removed — customers have no invite flow: modal, action, schema, service, `getCallerUserId` deleted. `claimInvitedCustomer` fallback in `portal.service.ts` still to remove (2026-10-02)                |
| RISK-044 | Low      | Pagination and helpers duplicated three times  | `customers-table.tsx`                              | Partly    | Shared `components/shared/pagination.tsx` and `lib/format.ts` used by customers and team; paths via `tenantPath()`. `portal-requests-list.tsx` and `billing-dashboard.tsx` still have their own pager (2026-10-02) |
| RISK-045 | Low      | Upload sequence duplicated in two forms        | `portal-request-detail.tsx`                        | Yes       | One `prepareAndUpload` helper in `upload.ts`, with the rollback, used by both forms (2026-10-02)                                                                                                                   |
| RISK-046 | Low      | Staff redirect duplicated in proxy             | `src/proxy.ts`                                     | Yes       |                                                                                                                                                                                                                    |
| RISK-047 | Low      | Errors shown as toast and alert                | `portal-toast.ts`                                  | Yes       | `portalToastResult` removed; failures show in the form's Alert only (2026-10-02)                                                                                                                                   |
| RISK-048 | Low      | DB types not generated from repo               | `src/lib/supabase/database.types.ts`               | Partly    | Docker not running, so types hand-edited: added `preferred_tenant_id`, both RPCs, `uuid_or_null`. `sla_breach`/`graphql_public` drift needs `supabase gen types --local`                                           |
| RISK-049 | Low      | Unsafe type casts hide mismatches              | `portal-new-request-form.tsx`                      | Yes       | `portalSignedInRequestFormSchema` replaces the resolver cast; `invalid()` filters undefined instead of casting (2026-10-02)                                                                                        |
| RISK-050 | Low      | All attachments signed, incl. internal         | `portal.service.ts`                                | Yes       | Only public-message files and the customer's (or guest's) opening-post files are signed (2026-10-02)                                                                                                               |
| RISK-051 | Low      | Customer exemption covers all central paths    | `src/proxy.ts`                                     | Yes       | Customer sessions are redirected off `/setup` only; `/login` stays open so a customer who also has a team account can sign in (2026-10-02)                                                                         |
| RISK-052 | Low      | Unused tenantName prop and fetch               | `customers-table.tsx`                              | Yes       | Prop and `getTenantContext` call removed (2026-10-02)                                                                                                                                                              |
| RISK-053 | Low      | Malformed customer id logged as error          | `customers/[customerId]/page.tsx`                  | Yes       | `isCustomerId` (`z.guid()`) → `notFound()` in layout, page and metadata (2026-10-02)                                                                                                                               |
| RISK-054 | Low      | Migration comments cite missing files          | `20260926104500_portal_password_prompt.sql`        | Yes       |                                                                                                                                                                                                                    |
| RISK-055 | High     | Reply RPC breaks whole hardening migration     | `20260926120000_portal_rls_hardening.sql`          | Yes       | plpgsql + `get diagnostics`; full chain applies in PGlite; reply/reopen tested                                                                                                                                     |
| RISK-056 | High     | Storage update/delete open across tenants      | `20260926120000_portal_rls_hardening.sql`          | Yes       | Storage update/delete scoped to tenant folder + staff roles; PGlite tests pass                                                                                                                                     |
| RISK-057 | High     | Customers can insert forged tickets            | `supabase/schemas/policies/09_tickets.sql`         | Yes       | `tickets_insert` staff-only in schema + migration; no app insert uses a customer session                                                                                                                           |
| RISK-058 | High     | Customers can repoint attachment storage_path  | `20260926090500_scope_attachments…sql`             | Yes       | Attachments update/delete staff-only (tenant_admin, manager, agent, billing_admin)                                                                                                                                 |
| RISK-059 | Medium   | ?error=constructor crashes portal login        | `src/features/portal/portal.ts`                    | Yes       | `Object.hasOwn` lookup; `rate_limited` and `invalid_credentials` given copy (2026-10-02)                                                                                                                           |
| RISK-060 | Medium   | Storage sweep deletes nothing                  | `supabase/functions/portal-storage-sweep/index.ts` | Yes       | Recursive listing keeps `<batch>/` in names                                                                                                                                                                        |
| RISK-061 | Medium   | Global password rule breaks team sign-up       | `supabase/config.toml`                             | Yes       | `password_requirements = ""` again; length 8 matches every form; digit rule stays in the portal form                                                                                                               |
| RISK-062 | Medium   | Storage read relies on path segment            | `20260926120000_portal_rls_hardening.sql`          | Yes       | Customer storage read joins `attachments` on storage_path (+ message on same ticket)                                                                                                                               |
| RISK-063 | Medium   | Customer can move message to other ticket      | `supabase/schemas/policies/10_ticket_messages.sql` | Yes       | Customer branch dropped from `ticket_messages_update`; staff branches unchanged                                                                                                                                    |
| RISK-064 | Low      | New RPCs missing from generated types          | `src/lib/supabase/database.types.ts`               | Yes       | Types added (see RISK-048); reopen row-count check is app side (RISK-042)                                                                                                                                          |
| RISK-065 | Low      | Leftover portal badge code, wasted query       | `customer-details.tsx`                             | Yes       | Invite flow removed — customers have no invite flow; badge leftovers and query deleted, ESLint warnings gone (2026-10-02)                                                                                          |
| RISK-066 | Low      | Dead CSAT comment action still exposed         | `portal.actions.ts`                                | Yes       | `addCsatCommentAction`, `addPortalCsatComment`, `portalCsatCommentSchema` deleted (2026-10-02)                                                                                                                     |
| RISK-067 | Low      | Sweep queries unpaged past 1000                | `supabase/functions/portal-storage-sweep/index.ts` | Yes       | Tenants query and `list()` paged with range/offset                                                                                                                                                                 |

> Update the **Completed** column as you fix each item. If a risk will not be fixed, replace `_Pending_` with the reason (for example: "Deferred to Q3 — requires auth refactor" or "Accepted risk — internal admin page only").
