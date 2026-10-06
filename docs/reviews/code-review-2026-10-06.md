# Code Review Report

- **Date:** 2026-10-06
- **Reviewer:** Claude Code (automated review)
- **Scope:** `src/features/sla-policies/` and `src/app/(app)/[tenantSlug]/(base-layout)/sla/` (SLA policies feature, including uncommitted changes on `feature/sla-policy`); SQL tables and RLS for `sla_policies`, `sla_policy_targets`, `sla_policy_customers` and `business_hours` read as supporting context · 20 files
- **Verdict:** NEEDS ATTENTION

---

## ⚡ 1. High-Risk Issues (Bugs, Security Leaks, Broken Logic)

### RISK-001 · `src/features/sla-policies/action/sla.actions.ts:81`

- **What is wrong:** The server never checks the plan's SLA policy limit. The only gate is the disabled "New policy" button on the list page. The comment at `sla.service.ts:685` says so.
- **Why it matters:** A Free tenant can open `/{slug}/sla/new` directly and create as many policies as they want. Calling `createSlaPolicyAction` from the browser console does the same. The plan limit, which is a paid feature, can be bypassed.
- **Recommendation:** Count the tenant's policies in `createSlaPolicy` and reject the save when `hasPolicyRoom` is false. Also gate the `/sla/new` page.
- **Minimal fix:**

```ts
// sla.service.ts — createSlaPolicy, after tenantId is resolved
const [{ count }, quota] = await Promise.all([
  supabase
    .from("sla_policies")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId),
  getSlaPolicyQuota(tenant),
]);
if (!hasPolicyRoom(quota, count ?? 0)) {
  throw new Error(
    `Your ${quota.planName} plan includes ${quota.limit} SLA policies.`,
  );
}

// sla/new/page.tsx
const [quota, policies] = await Promise.all([
  getSlaPolicyQuota(tenantSlug),
  fetchTenantSlaPolicies(tenantSlug),
]);
if (!hasPolicyRoom(quota, policies.length)) redirect(`/${tenantSlug}/sla`);
```

### RISK-002 · `src/features/sla-policies/service/sla.service.ts:833` (also `:892`, `:234`)

- **What is wrong:** Saving a policy takes 3 to 5 separate writes: the policy row, each target, the customer list, and then the default switch. They are not in a transaction. If any later step fails, the earlier steps stay saved.
- **Why it matters:** Here is a real path. A user creates an active "Selected customers" policy. One picked customer was deleted a moment ago, so the customer insert fails. The user sees "Reload and pick again." But the policy row is already saved, active, with zero customers. When they retry, a second policy is created. The first one stays and counts against the plan limit.
  - On update, `replacePolicyCustomers` deletes all customers first and then inserts. If the insert fails, the policy loses every customer.
  - In `makeDefaultPolicy`, if the second write fails, the old default is already paused and the tenant has no default SLA. Tickets that match no customer policy then have no SLA at all.
- **Recommendation:** Move the whole save into one Postgres function (RPC) so it all commits or all rolls back.
- **Minimal fix:**

```sql
-- one RPC; the service calls supabase.rpc("save_sla_policy", {...}) once
create or replace function public.save_sla_policy(
  p_policy_id uuid, p_row jsonb, p_targets jsonb, p_customer_ids uuid[], p_make_default boolean
) returns uuid language plpgsql security invoker as $$
begin
  -- insert/update sla_policies, upsert targets, replace customers,
  -- move is_default — all inside this one transaction
end $$;
```

---

## ⚠️ 2. Medium-Risk Issues (Performance, Anti-patterns, Next.js Violations)

### RISK-003 · `src/features/sla-policies/service/sla.service.ts:930`

- **What is wrong:** `updateSlaPolicy` spreads the whole client `dto` into the database update (`...dto`). Only `targets`, `customer_ids` and `is_default` are removed. A server action accepts any JSON the browser sends, so extra keys go straight to Postgres.
- **Why it matters:** A caller can write columns the editor never offers, such as `created_at` or `id`. Fields like `status`, `notify_before_mins` and the target minutes are also not checked on the server. The database rejects some bad values, but only after the earlier writes have run (see RISK-002).
- **Recommendation:** Build the update from an explicit list of allowed fields, and check them with a zod schema in the action.
- **Minimal fix:**

```ts
const updates = {
  name: dto.name,
  description: dto.description ?? "",
  status: dto.status,
  applies_to: dto.applies_to,
  business_hours_id: dto.business_hours_id ?? null,
  notify_before_breach: dto.notify_before_breach,
  notify_before_mins: dto.notify_before_mins,
  escalate_on_breach: dto.escalate_on_breach,
  escalate_to_role: dto.escalate_to_role,
  updated_at: new Date().toISOString(),
  updated_by: await currentUserId(supabase),
};
```

### RISK-004 · `src/features/sla-policies/service/sla.service.ts:1109`

- **What is wrong:** `deleteSlaPolicy` deletes the targets first and the policy second. Two cases break this:
  - A manager may delete targets but not policies (RLS: delete is `tenant_admin` only). The policy delete matches 0 rows and does not return an error. The action reports success.
  - `tickets.sla_policy_id` has no `ON DELETE` rule. Deleting a policy that tickets use fails with a foreign key error, after the targets are already gone.
- **Why it matters:** In both cases the policy survives with no targets, and the user is told it was deleted or shown a raw database error. There is no delete button today. But the action can still be called, because `use-sla-actions.ts` puts it in the client bundle. `DeletePolicyDialog` also suggests the button is coming soon.
- **Recommendation:** Delete only the policy row (targets and customers already cascade). Check that a row was actually deleted. Block the delete when tickets use the policy.
- **Minimal fix:**

```ts
const { data, error } = await supabase
  .from("sla_policies")
  .delete()
  .eq("id", id)
  .eq("tenant_id", tenantId)
  .select("id");
if (error?.code === "23503") throw new Error("Tickets still use this policy.");
if (error) throw new Error(error.message);
if (!data?.length)
  throw new Error("You don't have permission to delete this policy.");
```

### RISK-005 · `src/app/(app)/[tenantSlug]/(base-layout)/sla/new/page.tsx:12` (also `[policyId]/page.tsx`, `sla.actions.ts`)

- **What is wrong:** Any tenant member except `billing_admin` can open the editor. `isTenantRouteAllowed` lets agents through. The actions do no role check, so only RLS stops the write.
- **Why it matters:** An agent fills in the whole form and presses Save. Then they get a raw error like "new row violates row-level security policy". On update, RLS hides the row, so `.single()` fails with "Cannot coerce the result to a single JSON object". The same happens with the holiday and business-hours dialogs. The agent also gets up to 1,000 customer names and emails in the page payload.
- **Recommendation:** Check `getCallerRole()` in the editor pages and in each write action. Show a read-only view or redirect for other roles.
- **Minimal fix:**

```ts
const role = await getCallerRole();
if (role !== "tenant_admin" && role !== "manager")
  redirect(`/${tenantSlug}/sla`);
```

### RISK-006 · `src/features/sla-policies/service/sla.service.ts:338` (also `:614`, `:727`, `:111`)

- **What is wrong:** Read errors are swallowed and turned into "empty":
  - `loadPolicyTargets` returns `[]` on error, so the editor shows the default targets (60 min / 8 h).
  - `getSlaEditorData` returns an empty value on error, so the edit page shows a 404.
  - `fetchTenantSlaPolicies` returns `[]` on error, so the list says "No SLA policies yet".
  - `loadPolicyCustomerIds` treats any error that mentions the table name as "no customers".
- **Why it matters:** After one failed query, a manager sees default targets and presses Save. Their real targets are overwritten with defaults. With an empty list, `used` is 0, so the "New policy" button unlocks on a plan that is already full. If customer IDs fail to load, the scope check thinks no customers are taken. Two active policies can then claim the same customer.
- **Recommendation:** Throw on unexpected errors so `error.tsx` shows. Only return empty for the specific "migration not applied" codes.
- **Minimal fix:**

```ts
if (error) throw new Error(`Couldn't load SLA targets: ${error.message}`);
```

### RISK-007 · `src/features/sla-policies/service/sla.service.ts:342`

- **What is wrong:** `loadAppliedTicketCounts` downloads every ticket row that has a policy, then counts them in Node. PostgREST returns at most 1,000 rows (`max_rows = 1000` in `supabase/config.toml`).
- **Why it matters:** A tenant with more than 1,000 SLA tickets sees wrong counts in the "Applied to" column, and the numbers do not add up. The list page also gets slower as tickets grow, because all those rows load on every visit.
- **Recommendation:** Count in the database. Use one `count: "exact", head: true` query per policy, or a small RPC that groups by `sla_policy_id`.
- **Minimal fix:**

```ts
const counts = await Promise.all(
  policyIds.map(async (id) => {
    const { count } = await supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("sla_policy_id", id);
    return [id, count ?? 0] as const;
  }),
);
return Object.fromEntries(counts);
```

### RISK-008 · `src/features/sla-policies/service/sla.service.ts:525` (also `:488`)

- **What is wrong:** Holiday and schedule saves read the JSON column, change it in Node, and write the whole column back. Nothing stops two saves from running at the same time.
- **Why it matters:** Suppose two managers add a holiday to the same calendar within a second of each other. Both read the old list. The second write replaces the first, so one holiday is lost and nobody is told. The duplicate-date check can be skipped the same way.
- **Recommendation:** Do the change in SQL (a `jsonb` update in an RPC), or add an `updated_at` check to the update so a stale write fails.
- **Minimal fix:**

```ts
.update({ holidays_json: next, updated_at: new Date().toISOString() })
.eq("id", id)
.eq("tenant_id", tenantId)
.eq("updated_at", row.updated_at) // select updated_at in loadBusinessHoursRow
// then: no row returned → "Someone else changed this calendar. Reload and try again."
```

### RISK-009 · `src/features/sla-policies/components/business-hours-dialogs.tsx:216`

- **What is wrong:** The date picker for a new holiday only allows dates in the current year (`startMonth`/`endMonth` are fixed to `year`).
- **Why it matters:** In December, a manager cannot add 1 January next year as a one-time holiday. "Repeat every year" is the only way around it, and that is wrong for holidays that move each year, such as Easter or Diwali.
- **Recommendation:** Allow the current year and the next one, or allow any year.
- **Minimal fix:**

```tsx
const firstMonth = new Date(year, 0, 1);
const lastMonth = new Date(year + 1, 11, 1);
// captionLayout="dropdown" so the year can be picked too
```

### RISK-010 · `src/features/sla-policies/components/sla-policies-page.tsx:52` (also `business-hours-dialogs.tsx:74`)

- **What is wrong:** `formatUpdated` and `formatHolidayDate` call `toLocaleDateString(undefined, …)` inside client components. These components are also rendered on the server. The server uses its own locale and timezone (usually en-US, UTC). The browser uses the user's.
- **Why it matters:** A user in India or the UK gets a hydration mismatch. React throws away the server HTML for that part, and the date visibly changes after load (for example "Oct 5, 2026" becomes "6 Oct 2026"). An update made late in the evening can show the wrong day. `team.service.ts` already solves this with `serverNow`.
- **Recommendation:** Format dates on the server with a fixed locale and the tenant's timezone, and pass strings down. Or format only after mount.
- **Minimal fix:**

```ts
// sla.service.ts, when mapping rows
updated_label: new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: tenantTimeZone,
}).format(new Date(p.updated_at)),
```

### RISK-011 · `src/features/sla-policies/components/sla-policies-page.tsx:68` (also `hooks/use-sla-actions.ts:10`)

- **What is wrong:** The list page is a Client Component only so it can call `useSlaActions`. It then uses just `policies`. That hook copies `initialPolicies` into `useState`, which reads the prop only on the first render.
- **Why it matters:** The page ships the hook and two server-action references to the browser for nothing. If the list re-renders with fresh props while it is still on screen (`router.refresh()`, or revalidation after a save in another tab), the table keeps showing the old rows.
- **Recommendation:** Make the page a Server Component that renders `initialPolicies` directly. Keep only the tooltip button as a small client component.
- **Minimal fix:**

```tsx
// sla-policies-page.tsx: remove "use client" and the hook
const used = initialPolicies.length;
// ...
initialPolicies.map((policy) => <PolicyRow key={policy.id} ... />)
```

---

## 🏗️ 3. Architectural & Cross-File Findings

### RISK-012 · Affected files: `hooks/use-sla-actions.ts`, `components/delete-policy-dialog.tsx`, `action/sla.actions.ts`, `duration.ts`

- **What is wrong:** A lot of code is never used:
  - `handleToggleStatus`, `handleCreatePolicy` and `handleDeletePolicy`.
  - `DeletePolicyDialog`, which nothing imports.
  - `getSlaPoliciesAction`, `duplicateSlaPolicyAction` and `toggleSlaPolicyAction`, which no UI calls.
  - `parseDuration` and `formatDuration` in `duration.ts`.
- **Why it matters:** Unused server actions are still endpoints once a client file imports them. RISK-004 is only reachable because of this. Readers also assume features exist (delete, duplicate, toggle) that the UI does not offer.
- **Recommendation:** Delete the unused code now. Bring back each piece when its UI ships, together with tests.

### RISK-013 · Affected files: `types/types.ts`, `duration.ts`, `components/sla-editor.tsx`, `service/sla.service.ts`

- **What is wrong:** Four separate implementations turn minutes into text or units: `formatMinutes` ("4 hr"), `formatDurationShort` ("4h"), `formatDuration` ("4 hours"), and `toDurationInput`/`UNIT_MINS` in the editor. `UNITS` in `duration.ts` repeats `UNIT_MINS` again.
- **Why it matters:** The list's fallback description says "4 hr" while the targets column says "4h". A fix to rounding or units must be made in four places, so one gets missed.
- **Recommendation:** Keep one duration module (`duration.ts`) with the unit table and both short and long formatters. Import it everywhere.

### RISK-014 · Affected files: `action/sla.actions.ts`, `service/sla.service.ts`

- **What is wrong:** Error handling is inconsistent. Some actions use the `failure()` helper, and five copy the same `catch` block inline. Most errors pass the raw Postgres or PostgREST message to the toast.
- **Why it matters:** Users see messages like "violates check constraint chk_sla_resolution_ge_first_response" instead of plain words. It also shows table and constraint names to the browser.
- **Recommendation:** Use `failure()` everywhere. Map known codes (`23503`, `23505`, `23514`, `42501`, `PGRST116`) to user messages and log the rest.

### RISK-015 · Affected files: `service/sla.service.ts`, `sla/[policyId]/page.tsx`

- **What is wrong:** Several patterns are fragile:
  - The service keeps "migration not applied yet" fallbacks (`isMissingEditorColumn`, `isMissingCustomerScope`) that retry writes or hide errors.
  - "Not found" is signalled by an empty `name` instead of `null`.
  - UI helpers (`PRIORITY_SCOPES`, `emptyEditorTarget`) live in the server-only service file.
- **Why it matters:** The fallbacks double the write paths and hide real errors (see RISK-006). They also become dead once migrations `20261002120000` and `20261005120000` are live. A policy saved with an empty name would show as a 404. A client component can't import the shared helpers without pulling in server code.
- **Recommendation:** Remove the fallbacks once both migrations are applied to live. Return `null` for a missing policy. Move the shared constants to `types.ts`.

---

## 🧪 4. Required Test Cases

| Risk ID  | Test                                                                                                                                     | What it should prove                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| RISK-001 | On a Free tenant (limit 1) that already has 1 policy, call `createSlaPolicyAction` directly.                                             | It returns `success: false` with the plan message, and no row is inserted. |
| RISK-001 | On the same tenant, request `/{slug}/sla/new`.                                                                                           | The page redirects to `/{slug}/sla` and does not render the editor.        |
| RISK-001 | On an unlimited plan (`sla_policies: -1`) with 50 policies, create one more.                                                             | It succeeds, so `-1` is still read as unlimited.                           |
| RISK-002 | Create an active "Selected customers" policy where one customer ID is deleted just before the save (customer insert fails with `23503`). | No `sla_policies` row and no target rows remain afterwards.                |
| RISK-002 | Update a policy's customer list where the insert fails.                                                                                  | The policy still has its original customer list.                           |
| RISK-002 | Make policy B the default, and force the second `is_default` write to fail.                                                              | Policy A is still the default and still active.                            |
| RISK-002 | Send a target set with the same priority twice (unique violation on the second insert).                                                  | No partial targets are written, and the policy row is unchanged.           |

---

## 🏁 5. Verdict

**NEEDS ATTENTION.** The feature is well structured. The one-active-policy rules are shared cleanly between editor and server, and RLS covers every table. The two serious gaps are the plan limit, which only the browser enforces, and multi-step saves that can leave a half-written policy. Fix RISK-001 first, because it lets any tenant get a paid feature for free.

---

## 📋 6. Risk Tracking Table

| Risk ID  | Priority | Risk (Short Description)                           | File                                                              | Completed | Reason if Not Completed                                                                                                                                                                                                                                |
| -------- | -------- | -------------------------------------------------- | ----------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RISK-001 | High     | Plan policy limit not enforced on server           | `src/features/sla-policies/action/sla.actions.ts`                 | Yes       | Checked in `createSlaPolicy` and on `/sla/new`. Two creates sent at the same moment can still both pass (no DB constraint).                                                                                                                            |
| RISK-002 | High     | Multi-step saves leave half-written policies       | `src/features/sla-policies/service/sla.service.ts`                | Yes       | Undo in code (user's choice, no migration): a failed create deletes the new policy, a failed update restores the row, targets and customers, a failed default switch restores the old default. A crash in the middle of an undo can still leave a gap. |
| RISK-003 | Medium   | Update spreads unchecked client input              | `src/features/sla-policies/service/sla.service.ts`                | Yes       | Columns written one by one; actions check every field and target.                                                                                                                                                                                      |
| RISK-004 | Medium   | Delete wipes targets, policy may survive           | `src/features/sla-policies/service/sla.service.ts`                | Yes       | Delete action and service removed with the unused code (user's choice).                                                                                                                                                                                |
| RISK-005 | Medium   | Agents can open and submit editor                  | `src/app/(app)/[tenantSlug]/(base-layout)/sla/new/page.tsx`       | Yes       | Agents get a read-only editor (user's choice); `/sla/new` redirects them; write functions refuse non-admin/manager callers.                                                                                                                            |
| RISK-006 | Medium   | Swallowed read errors cause wrong saves            | `src/features/sla-policies/service/sla.service.ts`                | Yes       | Read errors throw to `error.tsx`; only the 'table not created yet' case returns empty. A malformed policy ID in the URL is a 404.                                                                                                                      |
| RISK-007 | Medium   | Ticket counts capped at 1000 rows                  | `src/features/sla-policies/service/sla.service.ts`                | Yes       | One count query per policy.                                                                                                                                                                                                                            |
| RISK-008 | Medium   | Concurrent holiday saves overwrite each other      | `src/features/sla-policies/service/sla.service.ts`                | Yes       | Business-hours saves check `updated_at`; a stale save is refused with a reload message.                                                                                                                                                                |
| RISK-009 | Medium   | Holidays limited to current year                   | `src/features/sla-policies/components/business-hours-dialogs.tsx` | Yes       | This year and next (user's choice), year dropdown added.                                                                                                                                                                                               |
| RISK-010 | Medium   | Locale date formatting causes hydration mismatch   | `src/features/sla-policies/components/sla-policies-page.tsx`      | Yes       | Fixed en-US locale and UTC in the new `format.ts`.                                                                                                                                                                                                     |
| RISK-011 | Medium   | List page needlessly client, stale state           | `src/features/sla-policies/components/sla-policies-page.tsx`      | Yes       | List is a Server Component; only `NewPolicyButton` is a client component.                                                                                                                                                                              |
| RISK-012 | Low      | Unused actions, hook handlers, dialog              | `src/features/sla-policies/hooks/use-sla-actions.ts`              | Yes       | Hook, delete dialog, unused actions/service functions and `parseDuration`/`formatDuration` removed.                                                                                                                                                    |
| RISK-013 | Low      | Four duplicate duration formatters                 | `src/features/sla-policies/duration.ts`                           | Yes       | All duration helpers live in `duration.ts`; `formatMinutes` removed. The list's fallback description now reads "4h" instead of "4 hr".                                                                                                                 |
| RISK-014 | Low      | Inconsistent errors, raw DB messages shown         | `src/features/sla-policies/action/sla.actions.ts`                 | Yes       | `failure()`/`invalid()` everywhere; known DB codes mapped to plain words, others logged.                                                                                                                                                               |
| RISK-015 | Low      | Migration fallbacks and fragile not-found sentinel | `src/features/sla-policies/service/sla.service.ts`                | Partly    | Not-found is now `null` and the helpers moved to `types.ts`. The migration fallbacks stay until migrations 20261002120000 and 20261005120000 are applied to live.                                                                                      |

> Update the **Completed** column as you fix each item. If a risk will not be fixed, replace `_Pending_` with the reason (for example: "Deferred to Q3 — requires auth refactor" or "Accepted risk — internal admin page only").
