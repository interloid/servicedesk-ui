# Code Review Report

- **Date:** 2026-10-14
- **Reviewer:** Claude Code (automated review)
- **Scope:** `src/features/saved-view/` (components, actions, service, filters), `src/app/(app)/[tenantSlug]/(base-layout)/views/`, saved-view SQL (`supabase/schemas/tables/16_saved_views.sql`, `policies/15_saved_views.sql`, `triggers/saved_views.sql`, `functions/22_seed_system_saved_views.sql`) · 12 files
- **Verdict:** NEEDS ATTENTION (fixed 2026-10-14 except RISK-002, see the tracking table)

---

Context: the RLS policies were checked against every claim the code makes about them ("owner only", "never a built-in view", "prefs only for views you can see"). They hold. Plan gating on the mutating actions is in place. The findings below are about losing user work, slow loads and a few leaks of internal detail.

## ⚡ 1. High-Risk Issues (Bugs, Security Leaks, Broken Logic)

**RISK-001** · `src/features/saved-view/components/saved-views-list.tsx:164-189`

- **What is wrong:** A new order is saved 400 ms after the last move. The unmount cleanup clears that timer and never sends the save.
- **Why it matters:** A user drags a view to the top and clicks its **Open** button straight away. The page unmounts inside the 400 ms window. The new order is silently dropped, and the ticket page tabs show the old order. The same happens with the mobile **Move up / Move down** menu followed by a quick tap on **Open**.
- **Recommendation:** On unmount, send any pending order immediately instead of throwing it away.
- **Minimal fix:**

```tsx
const pendingOrder = useRef<string[] | null>(null);

// where the timer is scheduled
pendingOrder.current = order;
saveTimer.current = setTimeout(async () => {
  pendingOrder.current = null;
  const res = await reorderSavedViewsAction(tenant, order);
  // ...unchanged
}, SAVE_DELAY_MS);

// replace the unmount cleanup
useEffect(
  () => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (pendingOrder.current) {
      void reorderSavedViewsAction(tenant, pendingOrder.current);
    }
  },
  [tenant],
);
```

## ⚠️ 2. Medium-Risk Issues (Performance, Anti-patterns, Next.js Violations)

**RISK-002** · `src/features/saved-view/services/saved-views.service.ts:175-213`

- **What is wrong:** `fetchTenantSavedViews` runs one `count` query per visible view. A user with 4 built-ins, 10 own views and 20 shared ones fires 34 ticket counts.
- **Why it matters:** This runs on every Views page load and on every tickets page load (the tabs use it via `fetchSavedViewTabs`). Each count scans the tenant's tickets with its own filter. As tickets and views grow, both pages get slower for everyone, and Supabase connection use spikes.
- **Recommendation:** Count all views in one database call (an RPC that takes the view ids and evaluates each `filter_json`), or load the counts after the page is shown, behind Suspense.
- **Minimal fix:**

```tsx
// page: show the list now, stream the numbers in
<Suspense fallback={<SavedViewsList initialViews={viewsWithoutCounts} ... />}>
  <SavedViewsWithCounts tenant={tenantSlug} ... />
</Suspense>
```

**RISK-003** · `src/features/saved-view/actions/saved-views.actions.ts:323-324`

- **What is wrong:** `reorderSavedViewsAction` calls `revalidatePath` after every saved reorder.
- **Why it matters:** Each drag makes the server re-render the Views page. That re-runs every count query from RISK-002. The client already shows the new order and throws the server's order away (the merge in `saved-views-list.tsx:129-144`), so the extra work buys nothing.
- **Recommendation:** Drop `revalidatePath` from the reorder action. The ticket page is dynamic and reads the order fresh on its next visit.
- **Minimal fix:**

```ts
await saveSavedViewOrder(tenantSlug, orderedIds);
return { success: true };
```

**RISK-004** · `src/features/saved-view/services/saved-views.service.ts:132-161`

- **What is wrong:** When the user, tenant or `saved_views` query fails, `fetchTenantSavedViews` returns `[]` instead of throwing.
- **Why it matters:** A database outage shows "The built-in views haven't been set up for this workspace yet" and "No custom views yet". The user thinks their views are gone. The route's `error.tsx` never shows, and nothing reaches Sentry except a console line.
- **Recommendation:** Throw on a real query error, so `error.tsx` renders and the error is reported. Keep `[]` only for "no user".
- **Minimal fix:**

```ts
if (error || !views) {
  throw new Error(`Couldn't load saved views: ${error?.message ?? "no data"}`);
}
```

**RISK-005** · `src/features/saved-view/actions/saved-views.actions.ts:52-60`

- **What is wrong:** `failed()` sends `error.message` straight to the user. That includes raw Postgres and PostgREST text from the service (`throw new Error(error.message)`).
- **Why it matters:** Users see messages like "new row violates row-level security policy for table saved_views" in the popup. This also tells an attacker table and policy names.
- **Recommendation:** Pass through only messages the code wrote for users. Log the rest and show the fallback.
- **Minimal fix:**

```ts
export class UserFacingError extends Error {}

function failed(error: unknown, fallback: string) {
  if (error instanceof UserFacingError) {
    return { success: false as const, error: error.message };
  }
  console.error(error);
  return { success: false as const, error: fallback };
}
// service: throw new UserFacingError("That view no longer exists, or isn't yours to edit.");
```

**RISK-006** · `src/app/(app)/[tenantSlug]/(base-layout)/views/page.tsx:31-36` · `saved-views.service.ts:31-52`

- **What is wrong:** The page passes full `SavedView` objects to a Client Component. Each one carries `owner_user_id` and `tenant_id`. No client code reads either field.
- **Why it matters:** Every view shared by a teammate puts that teammate's user id in the page's RSC payload, the data the server sends to the browser. `filters.ts:447-449` says the tabs were built specifically so the client "never sees owner ids". The Views page undoes that.
- **Recommendation:** Strip the two fields before they reach the client, with a client-facing type.
- **Minimal fix:**

```ts
export type SavedViewForClient = Omit<SavedView, "owner_user_id" | "tenant_id">;

// page.tsx
const clientViews: SavedViewForClient[] = views.map(
  ({ owner_user_id: _o, tenant_id: _t, ...rest }) => rest,
);
```

**RISK-007** · `src/features/saved-view/components/saved-views-list.tsx:542-561`

- **What is wrong:** `ViewSection`'s `useLayoutEffect` lists `children` as its dependency. `children` is a new array on every parent render, so the effect re-runs every time.
- **Why it matters:** During a drag, every pointer move re-renders the list. Each re-render tears down and rebuilds the `ResizeObserver` for both sections and measures the layout again. On long lists and slow phones, dragging stutters.
- **Recommendation:** Depend on the row count. The `ResizeObserver` already handles size changes.
- **Minimal fix:**

```tsx
const rowCount = Children.count(children);
useLayoutEffect(() => {
  // ...unchanged
}, [rowCount]);
```

**RISK-008** · `src/features/saved-view/components/create-saved-view-dialog.tsx:262-264` · `saved-views.actions.ts:174-185`

- **What is wrong:** The same-name check runs on every save, even when the name did not change.
- **Why it matters:** A user has a private view called "Urgent". Later a teammate shares their own "Urgent". Now the user can't change the filter of their own view: Save stays disabled until they rename it, for a clash they did not cause. The same-filter check has the same trap.
- **Recommendation:** When editing, run the name check only if the name changed. Apply the same rule on the server.
- **Minimal fix:**

```tsx
const nameChanged = !view || viewNameKey(view.name) !== viewNameKey(trimmed);
const sameName = nameChanged
  ? findSameNameView(views, trimmed, view?.id)
  : undefined;
```

**RISK-009** · `src/features/saved-view/filters.ts:416-421`

- **What is wrong:** The text condition strips `, ( ) " \` but does not reject what is left. A value of only those characters becomes an empty term. `%` and `_` are also not escaped, so they act as wildcards.
- **Why it matters:** A view "Text matching `(,)`" saves fine, reads as a filter, and shows **every** ticket. `_` in a search like `user_id` matches any single character, so the count and the list include tickets that don't contain the text.
- **Recommendation:** Reject a text condition that is empty after cleaning, in `parseInput` and in the popup. Escape `%` and `_`.
- **Minimal fix:**

```ts
// saved-views.actions.ts, parseInput
if (
  filter.rules.some(
    (rule) =>
      rule.field === "search" && !rule.value.replace(/[,()"\\]/g, "").trim(),
  )
) {
  return { ok: false, error: "Text conditions need letters or numbers." };
}
```

## 🏗️ 3. Architectural & Cross-File Findings

**RISK-010** · Affected files: `saved-views.actions.ts:233-244`, `supabase/schemas/tables/16_saved_views.sql`

- **What is wrong:** The 10-view limit and the same-name and same-filter rules are only checked in the action. The database does not enforce them. The check and the insert are separate steps.
- **Why it matters:** Two quick submits (double-click, two tabs) both pass the count check. The user ends up with 11 views, or two views with the same name. The popup then shows "11 of 10 used".
- **Recommendation:** Enforce the per-user limit in a `BEFORE INSERT` trigger that locks on the owner, and keep the app check for the friendly message. The name rule depends on what each viewer can see, so it can stay app-level. Write down that this is a known gap.

**RISK-011** · Affected files: `saved-views.service.ts:76-89, 263-335`, `saved-views.actions.ts:169-199, 233-244`

- **What is wrong:** One create runs `tenantIdFor` four times, `auth.getUser()` twice, and reads all of `saved_views` twice (name check, then filter check).
- **Why it matters:** Each save makes about eight round trips to Supabase where two would do. The Save button spins longer, and the two checks can see different data.
- **Recommendation:** Load the visible views once (`id, name, filter_json`) and run both `findSameNameView` and `findSameFilterView` on that list. Pass the tenant id down instead of resolving it in every helper.

**RISK-012** · Affected files: `saved-views.actions.ts:209-221`, `saved-views.service.ts:51, 209, 477`, `filters.ts:123, 233-235`

- **What is wrong:** Unused code: `getSavedViewsAction`, `isPinned` (always `false`, nothing sets it), `EMPTY_FILTER` as an export, `isEmptyFilter`, and `FREE_SEAT_LIMIT` (a second copy of the one in `features/team/types/team.ts`).
- **Why it matters:** `getSavedViewsAction` is a Server Action, so it is a public POST endpoint nobody calls but someone must still keep secure. The second `FREE_SEAT_LIMIT` will drift from the real one, and someone will import the wrong one.
- **Recommendation:** Delete them. Bring `isPinned` back with the pin feature.

**RISK-013** · Affected files: `saved-views.service.ts:22-30, 453-510`

- **What is wrong:** `getTenantEntitlements`, `readEntitlements` and `FREE_ENTITLEMENTS` live in the saved-view service. They decide branding, business hours, audit logs, advanced roles and SLA limits too.
- **Why it matters:** Any other feature that needs a plan check has to import from `saved-view`, or write its own copy. Two copies of "what does this plan allow" will disagree, and a paid feature leaks to free tenants.
- **Recommendation:** Move entitlements to `features/billing` (next to `getTenantPlanRecord`), and re-export from there.

## 🧪 4. Required Test Cases

The repo has no test runner yet (`package.json` has no `test` script). These are written for Vitest + React Testing Library, plus a Playwright check for the navigation case.

- **RISK-001** · Reorder with the arrow keys, then unmount the list within 100 ms. Assert `reorderSavedViewsAction` was called once with the new order. Proves a quick navigation no longer drops the order.
- **RISK-001** · Reorder, wait past 400 ms (save fires), then unmount. Assert the action was called exactly once. Proves the unmount flush does not double-save.
- **RISK-001** · Playwright: drag a custom view to the top, click its **Open** at once, then reload the Views page. The view is still on top.
- **RISK-008** · Edit a view whose name clashes with a teammate's shared view, change only the filter, and save. Save is enabled and succeeds.
- **RISK-008** · Edit the same view and change its name to another existing view's name. Save is disabled and the server action also refuses.
- **RISK-009** · `parseInput` with a search value of `"(,)"` returns an error. A value of `"refund"` passes.

## 🏁 5. Verdict

**NEEDS ATTENTION.** The access rules are sound: RLS matches the code's assumptions, and the plan gate is enforced on the server. The real problems are a reorder that is silently lost on quick navigation, and a load path that runs one ticket count per view on two busy pages. Fix RISK-001 first, since it loses user work with no message.

## 📋 6. Risk Tracking Table

| Risk ID  | Priority | Risk (Short Description)                    | File                           | Completed | Reason if Not Completed                                                                                                                                                       |
| -------- | -------- | ------------------------------------------- | ------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RISK-001 | High     | Pending reorder dropped on unmount          | `saved-views-list.tsx`         | Yes       | Fixed: a pending order is sent at once when the list unmounts                                                                                                                 |
| RISK-002 | Medium   | One ticket count query per view             | `saved-views.service.ts`       | No        | Deferred: one-query counts need a SQL function re-implementing the AND / OR fold and legacy filter shapes, plus a live migration; RISK-003 removes the extra reruns meanwhile |
| RISK-003 | Medium   | Reorder revalidates page, reruns all counts | `saved-views.actions.ts`       | Yes       | Fixed: reorder no longer calls revalidatePath                                                                                                                                 |
| RISK-004 | Medium   | Load errors shown as empty lists            | `saved-views.service.ts`       | Yes       | Fixed: load errors throw to error.tsx; ticket page tabs fall back to none so the queue still loads                                                                            |
| RISK-005 | Medium   | Raw database errors shown to users          | `saved-views.actions.ts`       | Yes       | Fixed: only SavedViewError messages reach users; the rest is logged                                                                                                           |
| RISK-006 | Medium   | Teammate user ids sent to browser           | `views/page.tsx`               | Yes       | Fixed: SavedView no longer carries owner_user_id / tenant_id                                                                                                                  |
| RISK-007 | Medium   | Layout effect reruns every render           | `saved-views-list.tsx`         | Yes       | Fixed: the effect depends on the row count                                                                                                                                    |
| RISK-008 | Medium   | Name check blocks editing own view          | `create-saved-view-dialog.tsx` | Yes       | Fixed in popup and action: name / filter checked only when changed                                                                                                            |
| RISK-009 | Medium   | Punctuation-only text matches every ticket  | `filters.ts`                   | Partly    | Punctuation-only text is rejected (popup, action, read). % and _ still act as wildcards, same as the queue's search box; escaping needs checking against PostgREST quoting    |
| RISK-010 | Low      | View limit not enforced in database         | `saved-views.actions.ts`       | Yes       | Fixed: enforce_saved_view_limit trigger (SV409); migration 20261015120000 pending on live. Same-name rule stays app-level by design                                           |
| RISK-011 | Low      | Repeated lookups on every save              | `saved-views.service.ts`       | Yes       | Fixed: loadSaveContext reads once per save                                                                                                                                    |
| RISK-012 | Low      | Unused exports and public dead action       | `saved-views.actions.ts`       | Yes       | Removed getSavedViewsAction, isPinned, isEmptyFilter, FREE_SEAT_LIMIT copy; EMPTY_FILTER now private                                                                          |
| RISK-013 | Low      | Plan entitlements live in saved-view        | `saved-views.service.ts`       | No        | Kept in saved-view by choice: moved to saved-view/services/entitlements.service.ts (own file, out of saved-views.service.ts)                                                  |

> Update the **Completed** column as you fix each item. If a risk will not be fixed, replace `_Pending_` with the reason (for example: "Deferred to Q3 — requires auth refactor" or "Accepted risk — internal admin page only").
