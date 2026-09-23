# Code Review Report

- **Date:** 2026-09-23
- **Reviewer:** Claude Code (automated review)
- **Scope:** `src/features/team/` · `src/app/(app)/[tenantSlug]/(base-layout)/settings/team/` · supporting files read for context (`src/components/shared/layout/role-route-guard.tsx`, `src/components/shared/modal-notice.tsx`, `src/components/ui/dialog.tsx`, `src/lib/tenancy.ts`, `supabase/migrations/20260810045832_initial_schema.sql`) · 13 files
- **Verdict:** NEEDS ATTENTION _(all 13 findings fixed on 2026-09-23 — see the tracking table)_

---

## ⚡ 1. High-Risk Issues (Bugs, Security Leaks, Broken Logic)

### RISK-001 · `src/features/team/services/team.service.ts:590,629,668`

**What is wrong:** Three guards compare the wrong two ids. `values.memberId` is a **membership row id**. `actor.userId` is an **auth user id**. They are different uuids for the same person, so `values.memberId === actor.userId` is never true.

**Why it matters:** The "you can't change your own role", "you can't change your own status" and "you can't remove yourself" checks never fire. The UI hides these actions on your own row, but the server action is callable directly. The database does not stop it either: `memberships_delete` and `memberships_update` only require `current_role() = 'tenant_admin'`, with no "not yourself" condition. A tenant admin can demote or delete their own membership and lock themselves out of the workspace. If they are the only tenant admin, nobody can undo it and no one can manage the team again.

**Recommendation:** Look up the target membership's `user_id` and compare that to `actor.userId`.

**Minimal fix:**

```ts
// in changeMemberRole / changeMemberStatus / removeMember, replace the id check
const { data: target } = await supabase
  .from("memberships")
  .select("user_id")
  .eq("id", values.memberId)
  .maybeSingle();

if (target?.user_id === actor.userId) {
  throw new TeamError("You can't change your own role.", {
    status: 409,
    code: "cannot-change-own-role",
  });
}
```

### RISK-002 · `src/app/(app)/[tenantSlug]/(base-layout)/settings/team/page.tsx:22`

**What is wrong:** The page does no role check. It calls `listTeamMembers()` and renders for anyone signed in to the tenant. The only route guard is `RoleRouteGuard`, a Client Component that runs a `useEffect` and only redirects `billing_admin`.

**Why it matters:** An Agent who types `/acme/settings/team` gets the whole staff roster: every colleague's full name, email address, role and status. The `memberships_select` policy allows any member of the tenant to read these rows, so the database does not stop it. For `billing_admin` the redirect happens **after** the page renders, so the roster is already in the RSC payload the browser received — the redirect hides the screen, not the data. This also contradicts the product rule the app now states: the permission matrix says an Agent's Team access is "None".

**Recommendation:** Check the caller's role on the server before fetching, and `notFound()` for anyone who is not a Tenant Admin or Manager.

**Minimal fix:**

```tsx
// page.tsx, before the Promise.all
const callerRole = await getCallerRole();

if (callerRole !== "Tenant Admin" && callerRole !== "Manager") {
  notFound();
}
```

### RISK-003 · `src/features/team/services/team.service.ts:412-433,505-507`

**What is wrong:** Inviting someone who already has an account sends no email. The branch at line 413 sets `authUserId` and `isExistingUser = true`, then skips `inviteUserByEmail`. Step 7, "Existing user → custom Resend email", is a comment with no code under it. `isExistingUser` is never read again.

**Why it matters:** The membership row is created with status `invited` and the UI shows "Invite sent." No mail is ever sent, so the person is never told they were added and never gets a link. They sit as a pending invite forever, holding a seat against the plan limit. This hits every invite to a person who already uses the product in another workspace — which is the exact case this branch exists to handle. Clicking "Resend invite" does not rescue them: `resendInvite` calls `inviteUserByEmail`, and Supabase rejects that for an already-registered address.

**Recommendation:** Send the existing user a workspace-invitation email (Resend, or `generateLink` with `type: "magiclink"`), and use the same path for resend when the account already exists.

**Minimal fix:**

```ts
// after the membership insert, when isExistingUser is true
if (isExistingUser) {
  await sendExistingUserInviteEmail({
    email,
    tenantSlug: actor.tenantSlug,
  }); // new helper; must not call inviteUserByEmail
}
```

---

## ⚠️ 2. Medium-Risk Issues (Performance, Anti-patterns, Next.js Violations)

### RISK-004 · `src/features/team/components/team-table.tsx:146-162`, `src/features/team/components/invite-member-modal.tsx:92-101`

**What is wrong:** `await action()` has no `try/catch`. Server actions return `{ ok: false }` for handled errors, but the call itself still rejects on a network drop, a deploy mid-request, or an unhandled server throw.

**Why it matters:** When it rejects, every line after the `await` is skipped. No toast appears, success or failure. `setPendingId(null)` never runs. The user clicks "Remove member", the dialog stays open, nothing happens and nothing explains why — so they click again.

**Recommendation:** Wrap the call in `try/catch/finally` and show an error toast in `catch`.

**Minimal fix:**

```tsx
startTransition(async () => {
  try {
    const result = await action();
    // ...existing handling
  } catch {
    toast.error("That didn't work. Check your connection and try again.");
  } finally {
    setPendingId(null);
  }
});
```

### RISK-005 · `src/features/team/services/team.service.ts:211-213,284-286,317-328`

**What is wrong:** One page render makes the same auth calls over and over. `listTeamMembers`, `getTeamSeats` and `getCallerRole` each create their own Supabase client and each call `auth.getUser()` and `auth.getClaims()`. `inviteMember` then calls `getTeamSeats()`, which does the whole thing a fourth time.

**Why it matters:** That is six auth round trips to render one screen, before any team data is read. Each one is a network call. The page is slower to appear for every admin who opens it, and every invite pays the cost again. `getTenantPlanRecord` already shows the fix in this same file — it is wrapped in React's `cache`.

**Recommendation:** Wrap `getActorOrNull` in `cache()` and rewrite `getCallerRole` to use it, so one render resolves the actor once.

**Minimal fix:**

```ts
const getActorOrNull = cache(async function getActorOrNull(
  supabase: SupabaseClient,
): Promise<TeamActor | null> {
  /* unchanged body */
});

export async function getCallerRole(): Promise<TeamRole | null> {
  const supabase = await createSupabaseServerClient();
  return (await getActorOrNull(supabase))?.role ?? null;
}
```

### RISK-006 · `src/features/team/services/team.service.ts:227,507,543`

**What is wrong:** Query results are forced into a type with `as unknown as`, which turns off every check TypeScript would do: `data as unknown as MemberRow[]`, `membership as unknown as MemberRow`, and the same trick in `resendInvite`.

**Why it matters:** The compiler now trusts a shape nobody verified. `inviteMember`'s select does not ask for `disabled_at`, yet the cast claims the row has it. Rename a column or drop a field from a select and the build still passes — the failure shows up as `undefined` in production instead. Line 507 is the sharpest case: the cast is used to read `row.created_at` from a row the select happens to include today.

**Recommendation:** Type the select result directly, or validate it with a small Zod schema before mapping.

**Minimal fix:**

```ts
// give the insert its own row type instead of reusing MemberRow
type InsertedMemberRow = Pick<MemberRow, "id" | "role" | "created_at" | "user">;
const row = membership as InsertedMemberRow;
```

### RISK-007 · `src/features/team/services/team.service.ts:576`

**What is wrong:** A debug line is still in the resend path: `console.log("🚀 ~ resendInvite ~ sendError:", sendError)`.

**Why it matters:** It runs on every resend in production and writes an emoji-prefixed line into the server logs, next to the real `[team]` error logs the file uses everywhere else. It also logs the raw Supabase error object, which is noise when it is null and duplicate output when it is not — `fail()` logs it two lines later.

**Recommendation:** Delete the line; `fail()` already logs the error.

**Minimal fix:**

```ts
// delete this line
console.log("🚀 ~ resendInvite ~ sendError:", sendError);
```

### RISK-008 · `src/features/team/components/team-table.tsx:98,103` and `src/features/team/team.ts:247`

**What is wrong:** `formatRelativeTime` reads `Date.now()` while rendering. The table is a Client Component, so it renders once on the server and again when it hydrates in the browser.

**Why it matters:** The two renders happen at different moments. The code rounds to whole minutes to hide this, which handles most cases, but a row whose timestamp crosses a minute boundary between the two renders produces different text — "1 minute ago" on the server, "2 minutes ago" in the browser. React logs a hydration mismatch and re-renders that subtree. It is rare and harmless to look at, but it is a real warning in the console.

**Recommendation:** Render relative times after mount, or pass a single "now" timestamp down from the server so both renders use the same value.

**Minimal fix:**

```tsx
// page.tsx
<TeamTable members={members} callerRole={callerRole} now={Date.now()} />
// team-table.tsx: thread `now` into both formatRelativeTime calls
```

---

## 🏗️ 3. Architectural & Cross-File Findings

### RISK-009 · Affected files: `src/features/team/team.ts`, `src/features/team/services/team.service.ts`

**What is wrong:** `TEAM_STATUS_ORDER` is exported from `team.ts` and never imported anywhere. The service defines its own identical `STATUS_ORDER` at line 268 and uses that.

**Why it matters:** Two copies of the same ordering exist. Add a fourth status and the exported one looks like the source of truth while the service quietly ignores it, so the sort order does not change.

**Recommendation:** Delete `STATUS_ORDER` from the service and import `TEAM_STATUS_ORDER`.

### RISK-010 · Affected files: `src/features/team/team.ts`

**What is wrong:** Eight exports have no consumer anywhere in `src/`: `TEAM_STATUS_HAS_DOT`, `TEAM_STATUS_DESCRIPTIONS`, `TEAM_STATUS_ORDER`, `TEAM_ACTION_KEYS`, `TEAM_FAILURE_CODE_VALUES`, `TEAM_OK`, `Entitlements`, `FREE_ENTITLEMENTS`.

**Why it matters:** `team.ts` is imported by every Client Component on this screen. Dead exports make the module look like the app's entitlements model when it is really the team screen's constants, and the next person has to read all 314 lines to find out which half is live.

**Recommendation:** Delete the unused exports. Move the entitlement types to the billing feature if they are meant for it.

### RISK-011 · Affected files: `src/features/team/team.ts`, `src/features/team/components/team-table.tsx`

**What is wrong:** `TEAM_ACTION_PERMISSIONS` declares six actions, but only four are ever checked. `canPerformTeamAction("resend", …)` and `canPerformTeamAction("revoke", …)` are never called. The table gates "Resend invite" behind `invite` and "Revoke invitation" behind `remove`.

**Why it matters:** The table is the written rule for who can do what, and two of its rows are decoration. Someone editing `revoke` to allow Managers would see no change in the UI and would have to find the real gate by reading the table component.

**Recommendation:** Either call the matching keys in `buildRowActions`, or delete the two unused entries so the object matches reality.

### RISK-012 · Affected files: `src/features/team/services/team.service.ts`, `src/features/team/schemas/team.ts`, `src/features/team/components/invite-member-modal.tsx`

**What is wrong:** Three loose ends around the invite path. `inviteMember` returns a fully built `TeamMember` that no caller uses — `inviteMemberAction` throws it away. That return value sets `invitedBy` to a user id, while `listTeamMembers` sets the same field to a display name. `inviteMemberSchema` accepts `fullName`, but the form has no name field and never sends one.

**Why it matters:** `TeamMember.invitedBy` means two different things depending on which function produced the object, so any future UI that shows "invited by" is wrong half the time. The unused return and the unused schema field both read as features that exist.

**Recommendation:** Return `void` from `inviteMember`, or make its `invitedBy` a display name like the list does. Drop `fullName` from the schema until the form collects it.

### RISK-013 · Affected files: `src/features/team/services/team.service.ts`

**What is wrong:** The service does not `import "server-only"`. `src/features/onboarding/services/onboarding.service.ts` does.

**Why it matters:** Today this is safe — the module imports `@/lib/supabase/admin`, which has the guard, so an accidental client import fails the build there instead. The protection is second-hand: remove the admin client from this file and the guard silently disappears.

**Recommendation:** Add `import "server-only";` as the first line, matching the onboarding service.

---

## 🧪 4. Required Test Cases

**RISK-001 — self-protection guards**

1. Call `changeMemberRoleAction({ memberId: <caller's own membership id>, role: "Agent" })` directly as a Tenant Admin. It must return `ok: false` with `failureCode: "cannot-change-own-role"`. Today it succeeds and demotes the caller.
2. Call `removeMemberAction` with the caller's own membership id as the only Tenant Admin in the tenant. It must fail with `cannot-remove-self`, and the membership must still exist afterwards. This proves the workspace cannot be left with no admin.

**RISK-002 — server-side role gate**

1. Request `/[slug]/settings/team` while signed in as an Agent. The response must be the 404 page, and the HTML must not contain any teammate's email address.
2. Request the same page as a Manager. It must render the table, proving the gate does not lock out a role that is supposed to be there.

**RISK-003 — invite to an existing account**

1. Invite an email that already has a user row from another tenant. Assert that an invitation email is sent, and that the membership is created with status `invited`.
2. Click "Resend invite" on that pending row. It must succeed, and must not call `inviteUserByEmail` for an address that is already registered.

---

## 🏁 5. Verdict

**NEEDS ATTENTION.** The screen itself is well built: it is a Server Component that fetches once and passes data down, it has a `loading.tsx` that mirrors the real layout, there is no `useEffect` data fetching anywhere, and the dialogs now share one set of tokens. The problems are in the service layer and in who is allowed to reach the page.

Fix RISK-002 first. It is the only finding where data leaves the server to someone who should not have it, and the fix is four lines in `page.tsx`. RISK-001 is a close second, because a tenant admin who removes their own membership cannot be recovered from inside the product.

---

## 📋 6. Risk Tracking Table

| Risk ID  | Priority | Risk (Short Description)                 | File                                                              | Completed | Reason if Not Completed                                                                                                  |
| -------- | -------- | ---------------------------------------- | ----------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| RISK-001 | High     | Self-protection guards compare wrong ids | `src/features/team/services/team.service.ts`                      | Yes       | Fixed 2026-09-23 — compares the target's user_id                                                                         |
| RISK-002 | High     | Team page has no server-side role check  | `src/app/(app)/[tenantSlug]/(base-layout)/settings/team/page.tsx` | Yes       | Fixed 2026-09-23 — notFound() for non-admin/manager                                                                      |
| RISK-003 | High     | Existing-user invite sends no email      | `src/features/team/services/team.service.ts`                      | Yes       | Fixed 2026-09-23 — magic link for existing accounts                                                                      |
| RISK-004 | Medium   | Server action rejection shows no error   | `src/features/team/components/team-table.tsx`                     | Yes       | Fixed 2026-09-23 — try/catch/finally + error toast                                                                       |
| RISK-005 | Medium   | Auth called six times per render         | `src/features/team/services/team.service.ts`                      | Yes       | Re-fixed as RISK-018 in code-review-2026-09-23-followup.md — the first cache() was keyed on a fresh client and never hit |
| RISK-006 | Medium   | Unsafe casts hide query shape changes    | `src/features/team/services/team.service.ts`                      | Yes       | Fixed 2026-09-23 — .returns<T>() and typed rows                                                                          |
| RISK-007 | Medium   | Debug console.log left in resend path    | `src/features/team/services/team.service.ts`                      | Yes       | Fixed 2026-09-23 — debug log deleted                                                                                     |
| RISK-008 | Medium   | Relative time can mismatch on hydration  | `src/features/team/components/team-table.tsx`                     | Yes       | Fixed 2026-09-23 — `now` passed from the server                                                                          |
| RISK-009 | Low      | Status order duplicated in two files     | `src/features/team/team.ts`                                       | Yes       | Fixed 2026-09-23 — service imports TEAM_STATUS_ORDER                                                                     |
| RISK-010 | Low      | Eight exports have no consumer           | `src/features/team/team.ts`                                       | Yes       | Fixed 2026-09-23 — unused exports deleted                                                                                |
| RISK-011 | Low      | Permission matrix has two dead keys      | `src/features/team/team.ts`                                       | Yes       | Fixed 2026-09-23 — resend/revoke keys now checked                                                                        |
| RISK-012 | Low      | Invite return value and schema unused    | `src/features/team/services/team.service.ts`                      | Yes       | Fixed 2026-09-23 — void return, fullName dropped                                                                         |
| RISK-013 | Low      | Service lacks server-only import         | `src/features/team/services/team.service.ts`                      | Yes       | Fixed 2026-09-23 — server-only imported                                                                                  |

> All 13 findings were fixed on 2026-09-23. `npx tsc --noEmit`, `npx eslint` and `npx next build` all pass.

> Update the **Completed** column as you fix each item. If a risk will not be fixed, replace `_Pending_` with the reason (for example: "Deferred to Q3 — requires auth refactor" or "Accepted risk — internal admin page only").
