# Code Review Report

- **Date:** 2026-10-22
- **Reviewer:** Claude Code (automated review)
- **Scope:** `src/app`, `src/features/*`, `src/components/shared`, `src/components/marketing`, `src/lib`, `src/hooks`, `src/actions`, `src/service`, `src/config`, `src/types`, `src/proxy.ts`, `src/instrumentation*.ts` · 324 files (shadcn `src/components/ui` skipped; Supabase migrations, schema policies and Edge Functions read where a finding depends on them)
- **Verdict:** CRITICAL

---

## Merge check (develop after feature/tickets, saved-view, report, branding-settings, notifications, audit-log)

- `tsc --noEmit` passes.
- No conflict markers in `src/` or `supabase/`.
- Migration timestamps are unique, and they run in the right order after the merge.
- Every `.rpc("…")` the app calls has a SQL definition in `supabase/`.
- Every page that the sidebar hides is also gated on the server. No nav link points to a missing route.
- ESLint fails with **5 errors**. See RISK-031.
- The sla-policy and ticket-engine branches agree on column names, units and `slaDayMins`. The gaps between them are RISK-015, RISK-018 and RISK-064.
- **Carried over:** RISK-002 to RISK-014 from `code-review-2026-10-21.md` (notifications) are still open in the code. RISK-001 from that report is fixed. Those items are tracked in that file and are not repeated or renumbered here.

---

## ⚡ 1. High-Risk Issues (Bugs, Security Leaks, Broken Logic)

### RISK-001 · `src/features/auth/components/tenant-login-form.tsx:52`

- **What is wrong:** The tenant login form passes the raw `?next=` value as `redirectTo`. `useLogin` (`use-auth.ts:86-101`) follows `redirectTo` and ignores the URL the server checked. An absolute URL to another site goes to `window.location.assign`.
- **Why it matters:** `/{slug}/login?next=https://evil.example` sends the user to the attacker's site right after a real login. That is a ready-made phishing step on your own domain. It also skips the billing-admin route check, because `loginAction` never sees `next`.
- **Recommendation:** Send `next` to the server and only follow the `redirectTo` the server returns.
- **Minimal fix:**

```tsx
// tenant-login-form.tsx
const { login, isPending } = useLogin({ next });
// use-auth.ts
const rawTarget = result.data.redirectTo;
```

### RISK-002 · `src/features/onboarding/services/onboarding.service.ts:163-256`

- **What is wrong:** The signup flow takes a list of invite emails. For each email that already has an account, it inserts an **active** membership into the new workspace. Nobody asks the invited person. It then queues a password-reset email to them. The "already in another workspace" guard from `team.service.inviteMember` is missing.
- **Why it matters:** An anonymous person can create a workspace and force any known email into it as active staff. The victim's name and email then show on the attacker's team page. The victim also gets a password-reset email they never asked for. The access-token hook prefers active staff memberships, so a victim who is only a portal customer, or only has a pending invite elsewhere, can land in the attacker's workspace after signing in.
- **Recommendation:** Never auto-activate an existing account from signup. Report it, and ask the founder to invite them from Team & roles.
- **Minimal fix:**

```ts
if (existingUser) {
  invitationResults.push({
    email: inviteEmail,
    status: "already_exists",
    message:
      "This person already has an account. Invite them from Team & roles.",
  });
  continue;
}
```

### RISK-003 · `src/features/onboarding/actions/register-actions.ts:12`

- **What is wrong:** `registerOnboardingAction` is the only public action in the signup flow with no `rateLimit`. `invite_users` has no `.max()` in `onboarding.schema.ts:41`. Invite emails are queued even when the founder has not confirmed their own email.
- **Why it matters:** One anonymous request can create auth users for, and send email to, an unlimited list of addresses from your Gmail sender. Repeating with a new slug repeats the spam. This harms sender reputation, which was already hit once (wrong-DKIM incident).
- **Recommendation:** Rate-limit the action, cap the invite list, and hold invites until the founder confirms.
- **Minimal fix:**

```ts
const { allowed } = rateLimit(`register:${await clientKey()}`, { limit: 3, windowMs: 15 * 60_000 });
if (!allowed) return { success: false, error: "Too many attempts. Try again later." };
// onboarding.schema.ts
invite_users: z.array(inviteUserSchema).max(10).default([]),
```

### RISK-004 · `src/service/user-service.ts:53-58`

- **What is wrong:** The staff profile action writes `email` and `avatar_url` straight from the client payload into `public.users`. The Email field is only disabled in the UI. RLS `users_update` allows any column on your own row.
- **Why it matters:** A staff member can call the action directly and set their email to someone else's address. That address then shows in the team list, mentions and audit views, and it takes the unique `users.email` value. A later invite or password reset for the real owner then collides with it. `avatar_url` can point to any external URL, so it loads in every colleague's browser, which leaks their IP to whoever runs that server.
- **Recommendation:** Never write `email` from this action. Only save an avatar URL that the server produced from an upload.
- **Minimal fix:**

```ts
.update({
  full_name: data.fullName,
  ...(serverAvatarUrl !== undefined ? { avatar_url: serverAvatarUrl } : {}),
  updated_at: new Date().toISOString(),
})
```

### RISK-005 · `src/features/portal/portal.ts:144-159`, `src/features/portal/services/portal.service.ts:1984`

- **What is wrong:** Portal attachments only check size. The stored Content-Type is whatever the customer's browser claims (`mime: file.type`). The agent app opens attachments through signed URLs with no `download` option, in a new tab (`ticket-detail-view.tsx:1282`). The agent upload path already has an extension allow-list, server-set types and a stored-type check. The portal copy of that code has none of the three.
- **Why it matters:** A guest can upload `x.html` as `text/html`, or an active SVG. It opens inline in the agent's browser on the storage origin, so the public gets a phishing or script vector against your support staff.
- **Recommendation:** Reuse the tickets attachment rules. Set the type on the server from the file extension, and delete any stored object whose type does not match.
- **Minimal fix:**

```ts
import { attachmentsError, attachmentContentType } from "@/features/tickets/lib/attachments";
const invalid = attachmentsError(files);
if (invalid) throw new PortalError(invalid, "validation");
// mint target
mime: attachmentContentType(file.name) ?? "application/octet-stream",
```

### RISK-006 · `supabase/schemas/policies/19_audit_logs.sql:19-26`

- **What is wrong:** The `audit_logs` insert policy only checks `actor_id = auth.uid()` and the tenant. Any member, including a portal customer, can insert rows from the browser with any `action`, `entity`, `module`, `result` and summary. The `audit_logs_fill` trigger keeps a client-sent `module` unless it is null or `general`.
- **Why it matters:** The new Business audit page shows these rows to admins as trusted records. A customer can plant a fake "Deleted SLA policy" row. They can also flood fake failed sign-ins into the "Security events" card.
- **Recommendation:** Allow only staff to insert directly, and only for the few events the app writes with the user's own client. Route everything else through the SECURITY DEFINER `audit_record` function.
- **Minimal fix:**

```sql
drop policy "audit_logs_insert" on public.audit_logs;
create policy "audit_logs_insert" on public.audit_logs for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and tenant_id = (select public.current_tenant_id())
  and (select public.current_tenant_role()) <> 'customer'
  and (action, entity) in (('login','user'),('logout','user'),('export','audit_log'),('update','notification_prefs'))
  and module is null and coalesce(result, 'success') = 'success'
);
-- check the (action, entity) pairs against auth.service.ts:638, audit.service.ts:706, notifications.service.ts:227
```

### RISK-007 · `src/app/(app)/[tenantSlug]/payment/cancel/page.tsx:28-47`

- **What is wrong:** The cancel page calls `abortPlanSwitchAction` every time it mounts. If a cancellation or downgrade is scheduled (`next_plan_id`), the `abort` branch in `supabase/functions/subscription/index.ts:929-1080` handles it before anything else. It resumes a SUSPENDED PayPal agreement and undoes the scheduled change.
- **Why it matters:** A customer who cancelled, then opens an old PayPal "Cancel and return" tab, history entry or bookmark, is silently reactivated. They are charged next cycle. The page then tells them "nothing was cancelled."
- **Recommendation:** The cancel page should only drop the pending checkout that matches the PayPal `token`. It must never touch `next_plan_id`.
- **Minimal fix:**

```ts
// page.tsx
abortPlanSwitchAction(tenantSlug, {
  checkoutOnly: true,
  token: searchParams.get("token"),
});
// subscription/index.ts, abort branch, first:
if (body?.checkoutOnly) {
  /* only clear sub.pending_plan_id when pending_order_id === body.token */
}
```

### RISK-008 · `src/features/team/types/team.ts:274`

- **What is wrong:** `CURRENT_SUBSCRIPTION_STATUSES` is `["active", "trialing"]`. The webhook sets `past_due` on SUSPENDED and on a single denied sale. `getTenantPlanRecord` then returns `null`, so every plan gate falls back to Free. The dunning migration says the tenant keeps their plan until the grace period ends. The billing page and the header read the plan another way and still show the paid plan.
- **Why it matters:** Reports, audit log, saved views, branding, the SLA quota and the seat limit all lock as soon as one payment fails. This happens even while PayPal is still retrying. A paying Business tenant drops to a 2-seat cap mid-month.
- **Recommendation:** Count `past_due` as current. The reconcile job already downgrades when the grace period ends.
- **Minimal fix:**

```ts
export const CURRENT_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
] as const;
```

### RISK-009 · `src/features/tickets/components/ticket-detail-view.tsx:589` (uncommitted)

- **What is wrong:** The new `R` shortcut calls `startComposing("public")`, which always sets the reply type to "Send to customer". It does this even when the composer holds an internal-note draft.
- **Why it matters:** An agent writes an internal note, clicks elsewhere, then presses R to get back to the box. The note is now set to public, and Enter sends it to the customer portal. One keystroke leaks internal text.
- **Recommendation:** Only switch to public when the draft is empty. Turn the shortcut off while support is closed.
- **Minimal fix:**

```tsx
useKeyboardShortcut(
  "r",
  () =>
    replyText.trim()
      ? replyInputRef.current?.focus()
      : startComposing("public"),
  !isClosed && !supportClosed,
);
```

### RISK-010 · `src/hooks/use-keyboard-shortcut.ts:17-25`

- **What is wrong:** `isShortcutBlocked` skips dialogs, menus and listboxes, but not a closed Radix `SelectTrigger`, which has `role="combobox"`. Radix also uses every letter key on the trigger for type-ahead, and does not call `preventDefault`.
- **Why it matters:** An agent changes status on a ticket, so focus stays on the Select. They press `r`. The status jumps to the first option starting with "R" (Resolved) and is saved, and the composer opens. Pressing `n` sets status "New" and navigates away. The filter Selects on the tickets list have the same problem with `a`, `e` and `n`.
- **Recommendation:** Treat comboboxes and grids as owning their keys.
- **Minimal fix:**

```ts
target.closest(
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="combobox"], [role="grid"]',
) !== null;
```

### RISK-011 · `src/lib/supabase/server.ts:63-71`

- **What is wrong:** @supabase/ssr always sends `maxAge: 400 days` when it sets a cookie, and `maxAge: 0` when it deletes one. With "Remember me" off, this code passes the 400 days through. With it on, which is also the default for `logout()`, it replaces the deletion's `maxAge: 0` with 30 days.
- **Why it matters:** On a shared computer, unticking "Remember me" keeps the user signed in for up to 400 days. That is longer than ticking it. After logout, empty `sb-*` cookies are written for 30 days instead of being deleted. `proxy.ts:174-186` also re-sets cookies with 400 days on every token refresh.
- **Recommendation:** Always honour deletions. Drop the expiry for non-remembered sessions. Store a "remember" marker cookie that the proxy also respects.
- **Minimal fix:**

```ts
const deleting = cookieOptions?.maxAge === 0;
...(deleting
  ? { maxAge: 0 }
  : remember
    ? { maxAge: REMEMBER_ME_MAX_AGE, expires: new Date(Date.now() + REMEMBER_ME_MAX_AGE * 1000) }
    : { maxAge: undefined, expires: undefined }),
```

### RISK-012 · `src/actions/user-actions.ts:15-19`

- **What is wrong:** The staff avatar is sent as a `File` inside the Server Action body. Next's default Server Action body limit is 1 MB. The client and the service both allow up to 5 MB. `next.config.ts` sets no `serverActions.bodySizeLimit`.
- **Why it matters:** A 1–5 MB photo passes the "under 5MB" check, but the request is rejected before the action runs. `profile-modal.tsx:109` only logs it to the console. The user sees nothing happen, and the photo is never saved.
- **Recommendation:** Use the signed direct upload the portal already uses (`preparePortalAvatarUploadAction`), and pass only the storage path to the action.
- **Minimal fix:**

```ts
// stopgap in next.config.ts
experimental: { serverActions: { bodySizeLimit: "6mb" } },
```

### RISK-013 · `src/app/(auth)/reset-password/page.tsx:49-118`

- **What is wrong:** The central reset page did not get the fixes the tenant copy got. It does not stop on `error_code=otp_expired`. It does not run the membership check. It does not remove `?code=` after exchanging it. An expired link falls through to `getSession()`.
- **Why it matters:** Onboarding invites and central password resets both link here. With an expired link on a browser that is already signed in, the page offers "Set a new password". That changes the signed-in account, not the account in the email. A removed member's link is not checked against their membership.
- **Recommendation:** Copy the error guard, the URL cleanup and the membership check from `[tenantSlug]/reset-password/page.tsx:244-273`.
- **Minimal fix:**

```ts
const sp = new URLSearchParams(window.location.search);
const hp = new URLSearchParams(window.location.hash.slice(1));
if (
  sp.get("error_code") ??
  sp.get("error") ??
  hp.get("error_code") ??
  hp.get("error")
) {
  window.history.replaceState({}, document.title, window.location.pathname);
  setAuthError("This link has expired or was already used. Request a new one.");
  return;
}
```

### RISK-014 · `src/components/shared/profile-modal.tsx:66, 239-257`

- **What is wrong:** The profile modal shows an "Email me when a ticket breaches SLA" switch. It always opens as ON, because `profile-menu.tsx:148-153` never passes the value. `updateUserProfileInSupabase` never saves it. The real setting is `email.sla` in the new Notification center.
- **Why it matters:** A user turns SLA emails off here and gets a "saved" message. They keep getting the emails, and the two screens disagree.
- **Recommendation:** Remove the switch and `slaNotification` from `profileFormSchema`, and link to the notification settings page instead.
- **Minimal fix:**

```tsx
<Link href={tenantPath(slug, TENANT_ROUTES.SETTINGS.NOTIFICATIONS)}>
  Notification preferences
</Link>
```

### RISK-015 · `src/features/reports/service/reports.service.ts:698-701`

- **What is wrong:** Reports only use the business-hours calendar when `first_response_business` is true. The SLA engine ignores that flag and uses the calendar whenever the policy has one. `provision_tenant` creates the Default SLA with a calendar but sets `first_response_business = false`, and the "days" targets are already stored as working-day minutes.
- **Why it matters:** A ticket created Friday evening and answered Monday morning shows as **met** on the ticket page. On any tenant that has not re-saved its Default SLA, Reports show it as **breached**. SLA attainment and agent SLA % come out too low.
- **Recommendation:** Choose the clock the way the engine does: from `business_hours_id` only.
- **Minimal fix:**

```ts
const calendar = policy?.business_hours_id
  ? (calendars.get(policy.business_hours_id) ?? null)
  : null;
```

### RISK-016 · `src/features/portal/services/portal.service.ts:1515-1528`

- **What is wrong:** `getDefaultPolicy` picks "active, default first, then oldest", but it does not exclude `applies_to = 'Selected customers'`. The database assigns a real ticket's policy with `sla_resolve_policy`, which does exclude those policies. On the same screen, `getNewTicketPolicyCalendar` already follows the right rule.
- **Why it matters:** The welcome screen, the new-request form and the footer can quote another customer group's reply target and hours. A signed-in customer with their own policy sees the wrong commitment. The "support is closed" note and the "reply within X" line can come from two different policies.
- **Recommendation:** Resolve the policy the same way `sla_resolve_policy` does: the customer's own policy first, otherwise exclude Selected-customers policies.
- **Minimal fix:**

```ts
.eq("tenant_id", tenantId).eq("status", "active")
.neq("applies_to", "Selected customers")
.order("is_default", { ascending: false }).order("created_at")
```

---

## ⚠️ 2. Medium-Risk Issues (Performance, Anti-patterns, Next.js Violations)

### RISK-017 · `src/features/reports/service/reports.service.ts:569-620`, `src/features/reports/service/business-time.ts`

- **What is wrong:** Reports work out met or missed in TypeScript instead of reading `sla_events`. This copy disagrees with the database engine in four ways. It counts paused (Pending or On hold) time. It treats "closed with no reply" as a miss. It uses today's policy targets instead of the target the clock started with. It judges tickets that had no policy.
- **Why it matters:** Reports contradict the ticket page and the SLA notifications agents already received. Every future engine change has to be copied into `business-time.ts` by hand. This is a cross-file duplicate that causes a real bug, so it is Medium.
- **Recommendation:** Read `sla_events` (`type = 'first_response'`) for the tickets in range. Count an open event past `due_at` as a miss.
- **Minimal fix:**

```ts
supabase
  .from("sla_events")
  .select("ticket_id, status, due_at")
  .eq("tenant_id", tenantId)
  .eq("type", "first_response")
  .in("ticket_id", createdIds);
// met = completed; missed = breached || (pending && due_at < now)
```

### RISK-018 · `src/features/sla-policies/components/sla-editor.tsx:385-390`

- **What is wrong:** The editor turns "N days" into minutes using the calendar it loaded when the page opened. The server (`sla.actions.ts:101-115`, `sla.service.ts:1314,1349`) only checks that the minutes are a positive whole number.
- **Why it matters:** Another admin shortens the working day while this page is open. On an unused policy, saving stores a "1 day" target that is really 9 working hours. On a policy in use, a rename-only save is refused with "policy in use".
- **Recommendation:** Recompute "days" minutes on the server from the calendar it loads, or reject values that don't divide evenly.
- **Minimal fix:**

```ts
if (t.firstResponseUnit === "days" && t.firstResponseMins % dayMins !== 0)
  throw new Error(
    "Business hours changed since you opened this page. Reload and try again.",
  );
```

### RISK-019 · `src/features/reports/service/reports.service.ts:257-260`

- **What is wrong:** The CSAT read has a `.catch` meant for "table not created yet". It catches every error: RLS, timeouts, bad columns. That migration is already in the tree.
- **Why it matters:** A real failure shows as "No ratings yet" with a "—" score. The rest of the file throws on errors so a failure never looks like a quiet week.
- **Recommendation:** Rethrow anything that is not a missing-table error.
- **Minimal fix:**

```ts
.catch((error: unknown) => {
  if (error instanceof ReportsQueryError && (error.code === "42P01" || error.code === "PGRST205"))
    return { rows: [], truncated: false };
  throw error;
})
```

### RISK-020 · `src/features/billing/components/pricing-cards.tsx:137-140`

- **What is wrong:** `window.location.assign(url)` returns straight away, so the transition ends and the button is enabled again before the page leaves. The same pattern is in `downgrade-dialog.tsx:127`, `undo-scheduled-change-button.tsx:338` and `resume-upgrade-approval-button.tsx:410`.
- **Why it matters:** A second click sends another create, abort or revise call to PayPal. That can open a second order, and the buyer approves whichever one PayPal shows last.
- **Recommendation:** Keep a `redirecting` flag that never resets.
- **Minimal fix:**

```ts
const [redirecting, setRedirecting] = useState(false);
if (res.approvalUrl) {
  setRedirecting(true);
  window.location.assign(res.approvalUrl);
  return;
}
// disabled={isPending || redirecting}
```

### RISK-021 · `src/features/billing/actions/billing-actions.ts:20`

- **What is wrong:** `changeTenantPlanAction` only revalidates `/account/billing`. The downgrade dialog runs on `/account/plans`, and its "scheduled" branch closes without `router.refresh()`.
- **Why it matters:** After scheduling a downgrade, the "Upcoming plan" badge and "Keep my current plan" never appear. The user can submit the same downgrade again.
- **Recommendation:** Revalidate the plans path too.
- **Minimal fix:**

```ts
revalidatePath(`/${tenantSlug}/account/plans`);
```

### RISK-022 · `src/features/billing/components/billing-dashboard.tsx:196-201`

- **What is wrong:** Every status except cancelled or trialing shows as a green "Active" pill. The dunning fields (`paymentTrouble`, `isSuspended`, grace date) are still computed in `billing-dashboard.service.ts:528-549`, but the banner that showed them was removed.
- **Why it matters:** A customer whose payment failed sees "Active" and no deadline. They find out when features lock. The server still pays for queries whose results nobody reads.
- **Recommendation:** Show `past_due` as "Payment failed" with the grace date, or delete the unused fields.
- **Minimal fix:**

```ts
data.billingStatus === "past_due" ? { label: "Payment failed", tone: "red" } : …
```

### RISK-023 · `src/features/billing/services/billing-dashboard.service.ts:235-263, 363-441`

- **What is wrong:** Four reads that don't depend on each other run one after another. The service loads every invoice with no limit, though the UI shows 5 per page, and it calls `createSignedUrl` once per invoice.
- **Why it matters:** The billing page gets slower with every invoice a tenant has. A two-year customer waits on 24+ storage calls per load.
- **Recommendation:** Use `Promise.all` and sign all invoice PDFs with one `createSignedUrls` call.
- **Minimal fix:**

```ts
const { data: signed } = await supabase.storage
  .from("invoices")
  .createSignedUrls(paths, 3600);
```

### RISK-024 · `src/app/auth/callback/route.ts:50-56, 100-102`

- **What is wrong:** `error_description` from the query string is copied into `/login?error=…` and shown in the red alert. The tenant callback (`[tenantSlug]/auth/callback/route.ts:149-156`) does the same. The portal callback already uses fixed codes.
- **Why it matters:** A crafted link can show any message on the real login page, for example "Your account is locked, call +1-…". React escapes it, so this is not XSS, but it is convincing phishing text.
- **Recommendation:** Pass a fixed code and map it to safe text on the page.
- **Minimal fix:**

```ts
return failure("provider_error"); // page: ERROR_COPY[code] ?? ERROR_COPY.unknown
```

### RISK-025 · `src/features/auth/services/auth.service.ts:322-360, 419-443`

- **What is wrong:** The central forgot-password and reset-password flow does not check for a revoked membership. The tenant flow does, and its own comment explains why.
- **Why it matters:** A revoked invitee can mail themselves a link and set a password. That is exactly the gap the tenant flow closed. The impact is limited, because the session has no workspace.
- **Recommendation:** Skip sending the link when the user has no non-disabled membership.
- **Minimal fix:**

```ts
const { count } = await supabase
  .from("memberships")
  .select("id", { count: "exact", head: true })
  .eq("user_id", user.id)
  .neq("status", "disabled");
if (!count) return { success: true };
```

### RISK-026 · `src/features/onboarding/components/onboarding-wizard.tsx:124`

- **What is wrong:** `await registerOnboardingAction(payload)` has no try/catch. If the request fails (network drop, deploy mid-request), `setIsSubmitting(false)` never runs.
- **Why it matters:** The full-screen loader spins forever with no error. The user must reload and lose the whole signup form.
- **Recommendation:** Wrap the call and show an error.
- **Minimal fix:**

```ts
try {
  response = await registerOnboardingAction(payload);
} catch {
  setIsSubmitting(false);
  setErrorMessage("Network error. Try again.");
  return;
}
```

### RISK-027 · `src/features/onboarding/components/onboarding-wizard.tsx:89-95, 116-121`

- **What is wrong:** On the last step, "Skip" calls `handleFinish`, which sends whatever invites were already typed.
- **Why it matters:** People the founder chose not to invite still get emails and take seats.
- **Recommendation:** Send an empty invite list when skipping from the last step.
- **Minimal fix:**

```ts
const handleSkip = () =>
  currentStep === TOTAL_STEPS ? handleFinish(true) : handleNext();
// handleFinish(skipInvites): invite_users: skipInvites ? [] : formData.invites
```

### RISK-028 · `src/features/notifications/services/notifications.service.ts:253-262`

- **What is wrong:** "Settings history" reads a user's own preference changes from `audit_logs` with their own client. The new select policy from `20261021120000` only allows admins and managers, and only on plans with audit logs.
- **Why it matters:** Every agent, and admins on Free or Pro, see a "Settings history" tab that always says "No preference changes to show", even though the rows exist.
- **Recommendation:** Add a narrow "own preference rows" select policy, or a small SECURITY DEFINER RPC.
- **Minimal fix:**

```sql
create policy "audit_logs_select_own_prefs" on public.audit_logs for select to authenticated
using (actor_id = (select auth.uid()) and entity = 'notification_prefs'
       and tenant_id = (select public.current_tenant_id()));
```

### RISK-029 · `supabase/migrations/20261021120000_audit_log_page.sql:834-842`

- **What is wrong:** The audit select policy calls `current_tenant_id()`, `current_tenant_role()` and `current_tenant_has_feature()` without wrapping them in `(select …)`. Postgres may then run them once per row. `loadAuditPage` runs 8 queries through this policy on every load: the page list, the summary RPC and 6 exact counts.
- **Why it matters:** A busy Business tenant with a 12-month range runs tens of thousands of plan lookups per page load. The audit page slows down as the log grows.
- **Recommendation:** Wrap each call in `(select …)`, which is Supabase's documented RLS pattern.
- **Minimal fix:**

```sql
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_tenant_role()) in ('tenant_admin', 'manager')
  and (select public.current_tenant_has_feature('audit_logs'))
);
```

### RISK-030 · `src/features/branding/…` → `supabase/schemas/functions/09_get_tenant_by_slug.sql`

- **What is wrong:** `get_tenant_by_slug` only returns `primary_color` and `logo_url`. The secondary, text and background colours, and `show_logo_on_portal`, never reach the portal. The branding preview honours all of them. (The portal wiring was deferred on purpose when branding shipped. It is listed here because the editor already offers these controls.)
- **Why it matters:** An admin turns the logo off or picks colours, sees them in the preview, and customers never see the change.
- **Recommendation:** Return the missing keys from the function, and gate the logo on `show_logo_on_portal`. If that stays deferred, hide those controls.
- **Minimal fix:**

```sql
'secondary_color', t.branding_json->>'secondary_color',
'text_color', t.branding_json->>'text_color',
'background_color', t.branding_json->>'background_color',
'show_logo_on_portal', coalesce((t.branding_json->>'show_logo_on_portal')::boolean, true),
```

### RISK-031 · `src/features/audit/services/audit.service.ts:326-328`

- **What is wrong:** The `eslint-disable-next-line` comment sits above `function applyFilters<`, but the five `any` types are on the next line.
- **Why it matters:** `npm run lint` fails with 5 errors, so CI and the pre-commit hook fail on develop.
- **Recommendation:** Move the comment directly above the line with the `any` types.
- **Minimal fix:**

```ts
function applyFilters<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST builder generics
  Q extends { eq: any; gte: any; lt: any; is: any; or: any },
>(
```

### RISK-032 · `src/features/portal/components/portal-requests-list.tsx:78, 86-114`

- **What is wrong:** `term` is copied from the `search` prop once and never synced again. In this Next version the page stays mounted when only the query string changes.
- **Why it matters:** A customer searches "abc", then clicks the header logo to go back to all requests. 300 ms later the effect puts `q=abc` back. They cannot leave the search by navigating.
- **Recommendation:** Reset `term` during render when `search` changes.
- **Minimal fix:**

```tsx
const [syncedSearch, setSyncedSearch] = useState(search);
if (search !== syncedSearch) {
  setSyncedSearch(search);
  setTerm(search);
}
```

### RISK-033 · `src/app/(app)/[tenantSlug]/(base-layout)/tickets/(overview)/page.tsx:85, 98`

- **What is wrong:** The page still runs `fetchTicketStatusCounts` (6 count queries) on every render. Its only reader, `allCount` in `tickets-table.tsx:474`, is unused. The prop doc says the status tabs show when saved-view tabs fail. That fallback no longer exists.
- **Why it matters:** There are 6 wasted database round-trips on every filter change, page change and realtime refresh. When `fetchSavedViewTabs` returns `[]`, the tab bar is empty with no "All tickets" tab. That happens on a load error, or on live until migrations 20261014120000/20261015120000 are applied.
- **Recommendation:** Remove the counts query and the dead prop, or restore the status-tab fallback.
- **Minimal fix:**

```tsx
const [{ tickets, totalCount }, currentUser, viewTabs] = await Promise.all([
  fetchTenantTickets(tenantSlug, { … }),
  getCurrentUserIdentity(tenantSlug),
  fetchSavedViewTabs(tenantSlug),
]);
```

### RISK-034 · `src/features/tickets/actions/tickets.actions.ts:326-342`

- **What is wrong:** `sendTicketMessageAction` and `prepareTicketUploadsAction` (`:108-120`) never check whether the ticket is closed. Only the UI hides the composer.
- **Why it matters:** `sla_tick` can auto-close a ticket while an agent's tab is open. A reply already in flight, or a direct POST, then lands on a closed ticket and shows on the portal.
- **Recommendation:** Refuse replies to closed tickets on the server.
- **Minimal fix:**

```ts
if (ticket.status === "closed")
  return {
    success: false,
    error: "This ticket is closed. Reopen it to reply.",
  };
```

### RISK-035 · `src/features/saved-view/services/saved-views.service.ts:174-207`

- **What is wrong:** `fetchSavedViewTabs` runs one exact `count` query for every visible view. It also runs a preferences query and an uncached `tenants` lookup. The tickets page waits for all of them inside one `Promise.all`.
- **Why it matters:** The ticket list cannot paint until the slowest tab count returns. This repeats on every realtime refresh and filter change, and gets slower as views are added.
- **Recommendation:** Stream the tabs in their own `<Suspense>` so the table never waits on them.
- **Minimal fix:**

```tsx
<Suspense fallback={<TabsSkeleton />}>
  <ViewTabs tenantSlug={tenantSlug} />
</Suspense>
```

### RISK-036 · `src/components/shared/email-verification-handler.tsx:21-43`

- **What is wrong:** This handler is mounted globally. It reacts to any `?error=` in the URL, including the tenant and portal login pages' own error redirects. It shows "Email link is invalid or has expired" and strips the query string. It also repeats `auth/confirm/confirm-handler.tsx`.
- **Why it matters:** A "You don't have access to this workspace" error shows next to a wrong toast about an expired email link. Users can't tell which message is true.
- **Recommendation:** Only react to Supabase's own link parameters (`error_code`, `token_hash`, `#access_token`), and skip login paths.
- **Minimal fix:**

```ts
const OWNED_PATHS =
  /\/(reset-password|auth\/callback|auth\/confirm|login|portal\/login)$/;
```

### RISK-037 · `src/lib/auth-broadcast.ts:5-38`

- **What is wrong:** `broadcastLogout` posts to a BroadcastChannel and also writes to localStorage. `subscribeToLogout` listens to both.
- **Why it matters:** Logging out in one tab shows two "You were logged out in another tab" toasts in the others, and redirects twice.
- **Recommendation:** Use the storage event only when BroadcastChannel is missing.
- **Minimal fix:**

```ts
if ("BroadcastChannel" in window) {
  /* post */ return;
}
try {
  localStorage.setItem(KEY, String(Date.now()));
} catch {}
```

### RISK-038 · `src/components/shared/layout/header-search.tsx:14, 30-31`

- **What is wrong:** `query` is local state that nothing reads. There is no submit and no navigation. The mobile search button (`app-header.tsx:26-33`) has no `onClick`. The `/` shortcut calls `preventDefault` even below `lg`, where the input is hidden.
- **Why it matters:** The `/` shortcut, which the shortcuts modal lists, leads to a search box that never searches. The mobile search icon does nothing.
- **Recommendation:** Make it a form that goes to the tickets list with `?search=`, or hide it until search exists.
- **Minimal fix:**

```tsx
<form onSubmit={(e) => { e.preventDefault(); router.push(`${tenantPath(slug, TENANT_ROUTES.TICKETS)}?search=${encodeURIComponent(query)}`); }}>
```

### RISK-039 · `src/components/shared/profile-modal.tsx:53-56, 95-115`

- **What is wrong:** A failed save whose result has no `errors` field (Unauthorized, upload failure) shows no message. A thrown error is only logged to the console. Cancel does not reset `selectedFile` or `previewUrl`.
- **Why it matters:** Saves fail with no feedback. A photo the user backed out of is uploaded on their next save.
- **Recommendation:** Toast the message, and reset the file state when the modal closes.
- **Minimal fix:**

```ts
if (!result.success && !result.errors) toast.error(result.message);
// on close: setSelectedFile(null); setPreviewUrl(initialValues?.avatarUrl ?? null); form.reset();
```

### RISK-040 · `src/lib/identity.ts:48-170`

- **What is wrong:** `getShellIdentity` runs about 7 queries one after another. The subscription, tenant, member-count and profile reads don't depend on each other. The function is not wrapped in `cache()`.
- **Why it matters:** Every hard navigation into the dashboard waits for 7 round-trips in a row before the first byte.
- **Recommendation:** Run the independent reads in parallel, and wrap the function in `cache()`.
- **Minimal fix:**

```ts
const [tenantRes, subRes, countRes, profileRes] = await Promise.all([/* … */]);
export const getShellIdentity = cache(async (slug: string) => {
  /* … */
});
```

### RISK-041 · `src/app/(app)/[tenantSlug]/payment/cancel/page.tsx:49-58`

- **What is wrong:** `router.push` is called inside the `setCountdown` updater. Updaters must be pure, and React can call them twice. The interval is not cleared when the user clicks "Go to Account & Plan".
- **Why it matters:** The redirect can fire twice. A user who clicks the button and moves on can be pulled back to `/account/plans` by the timer.
- **Recommendation:** Use the timeout-per-tick effect from `payment/success`.
- **Minimal fix:**

```ts
useEffect(() => {
  if (countdown <= 0) {
    router.push(targetRedirectUrl);
    return;
  }
  const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
  return () => clearTimeout(t);
}, [countdown, router, targetRedirectUrl]);
```

### RISK-042 · `src/app/(app)/[tenantSlug]/(base-layout)/reports/page.tsx:12`

- **What is wrong:** The Reports title and the Notifications settings title (`settings/notifications/page.tsx:12`) already end in "| ServiceDesk Pro". The root template adds it again.
- **Why it matters:** The browser tab reads "Reports | ServiceDesk Pro | ServiceDesk Pro".
- **Recommendation:** Use the bare page name.
- **Minimal fix:**

```ts
export const metadata: Metadata = { title: "Reports" };
```

### RISK-043 · `src/app/layout.tsx:22-31`

- **What is wrong:** The root layout sets `alternates.canonical: "/"` and `openGraph.url: "/"`. Every route that does not override them inherits them.
- **Why it matters:** `/setup` (the signup page) and `/forgot-password` tell search engines they are the home page, so the signup page can drop out of search results.
- **Recommendation:** Keep the canonical only on `app/page.tsx`, which already sets it.
- **Minimal fix:**

```ts
// layout.tsx: delete `alternates: { canonical: "/" }` and `openGraph.url`
```

### RISK-044 · `src/proxy.ts:248-331, 559-563`

- **What is wrong:** The proxy matcher does not exclude `/opengraph-image`. `stripTenantPrefix` reads it as a tenant called "opengraph-image", so an anonymous request gets a 302 to `/opengraph-image/login`.
- **Why it matters:** Links shared in Slack, X or LinkedIn show no preview image, although the layout declares `summary_large_image`.
- **Recommendation:** Exclude metadata routes in the matcher.
- **Minimal fix:**

```ts
matcher: ["/((?!_next/static|_next/image|favicon.ico|opengraph-image|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
```

---

## 🏗️ 3. Architectural & Cross-File Findings

### RISK-045 · Affected files: `src/features/reports/types/types.ts:115`, `src/features/team/services/team.service.ts:1046-1072`, `src/features/saved-view/services/entitlements.service.ts`, `src/features/audit/services/audit.service.ts:49`, `src/features/sla-policies/types/types.ts:375`, `src/lib/identity.ts`

- **What is wrong:** Plan gating uses three sources. Reports check the plan **name** (`!== "free"`). Audit, saved views and SLA read `features_json` from `subscriptions`, each parsing it separately. Identity and the plans page read `tenants.plan_id`. The shared `getTenantEntitlements` lives in the saved-view folder, and only `views/page.tsx` uses it.
- **Why it matters:** Renaming a plan, or adding a tier, unlocks or locks Reports separately from what billing sold. When the subscription row is missing, the header shows "Pro" while every gate says Free (see RISK-008).
- **Recommendation:** Move `getTenantEntitlements` to `features/billing` and have every gate use it. Give `getTenantPlanRecord` the same `tenants.plan_id` fallback.

### RISK-046 · Affected files: `src/features/auth/components/login-form.tsx`, `tenant-login-form.tsx`, `forgot-password-form.tsx`, `forget-tenant-password-form.tsx`, `src/features/onboarding/services/onboarding.service.ts:134-401`

- **What is wrong:** The login and forgot-password forms each exist twice and have drifted apart. Onboarding has its own invite flow next to `team.service.inviteMember`.
- **Why it matters:** The drift has already caused RISK-001, RISK-002 and RISK-025. The fix landed in one copy and not the other.
- **Recommendation:** Use one `LoginForm` and one forgot-password form, each with an optional `tenantSlug`. Route onboarding invites through the team invite service.

### RISK-047 · Affected files: `src/components/shared/layout/global-shortcuts.tsx:12, 28-29`, `src/components/shared/role-route-guard.tsx:31`, `src/components/shared/layout/app-sidebar.tsx:72-224`, `src/components/shared/keyboard-shortcuts-modal.tsx:18-27`, `src/features/branding/…` (`canEditBranding`)

- **What is wrong:** Role and route rules are copied instead of using `lib/tenancy` helpers. `BILLING_ROLES` is hard-coded again. The sidebar uses literal hrefs. The shortcuts modal lists ticket shortcuts to billing admins, who cannot use them. Role checks come in four styles, and branding reads `claims.tenant_role` directly.
- **Why it matters:** A route rename or role change has to be made in four places, so the nav, the shortcuts and the guards drift apart.
- **Recommendation:** Use `isTenantRouteAllowed`, `defaultTenantLanding` and `TENANT_ROUTES` everywhere, and put role checks behind one helper in `features/auth/claims`.

### RISK-048 · Affected files: `src/features/tickets/services/tickets.service.ts:218, 1517`, `src/features/saved-view/filters.ts:6-36, 166`, `src/features/tickets/lib/sla-calendar-row.ts`, `src/features/sla-policies/service/sla.service.ts:532-590`, `src/hooks/use-realtime-portal-request.ts:29-51`, `src/hooks/use-realtime-tickets-refresh.ts:69-91`, `src/features/notifications/lib/feed.ts`, `src/lib/format.ts`, `src/lib/identity.ts:177-182`

- **What is wrong:** Several helpers are copied across features:
  - The search sanitiser has 3 copies.
  - The ticket status and priority enums and labels have 2 copies.
  - Business-hours JSON parsing has 2 copies with different holiday rules.
  - The realtime debounce scheduler has 2 copies.
  - `formatRelative` exists in both `feed.ts` and `lib/format.ts`. The bell says "5 min ago" and tables say "5 minutes ago".
  - `getInitials` is written again in `identity.ts`.
- **Why it matters:** The PostgREST filter-escaping guard can drift between copies. A holiday without a name counts in one place and is ignored in another.
- **Recommendation:** Export `searchTerm`, the enums, `toSlaCalendar`, `formatRelativeTime` and a `useDebouncedRefresh` hook from one place each, and import them.

### RISK-049 · Affected files: `src/lib/email/send-email.ts`, `src/config/server-env.ts:18-19`, `src/lib/notifications-shared.ts` (`toUiNotification`, `UiNotification`, `TYPE_META`), `src/lib/tenancy.ts:387` (`tenantPrefix`)

- **What is wrong:** These exports are dead code left over from the merges. The old Resend sender, `RESEND_API_KEY` and `FROM_EMAIL` have no importers, because mail now goes through `email_jobs` and Gmail. `TYPE_META` titles differ from the real mapping in `feed.ts`.
- **Why it matters:** Someone fixing notification titles or email sending edits the dead copy and nothing changes.
- **Recommendation:** Delete them. Keep only the `NotificationType`/`NotificationPayload` types, derived from `Database["public"]["Enums"]["notification_type"]`.

### RISK-050 · Affected files: `src/app/(app)/[tenantSlug]/auth/callback/route.ts`, `src/lib/tenancy.ts:347`

- **What is wrong:** Nothing links to this tenant auth callback. A signed-out user cannot reach it anyway, because the proxy sends them to login first.
- **Why it matters:** It is a second callback with its own error handling (see RISK-024) that nobody tests.
- **Recommendation:** Delete the route and `tenantAuthCallbackPath`.

### RISK-051 · Affected files: `src/lib/supabase/client.ts:5,12`, `src/lib/supabase/server.ts:43,82`, `src/lib/supabase/admin.ts:7,24`

- **What is wrong:** The three Supabase clients are created without `<Database>`, so query results are untyped. That is why casts like `payload.new as TicketMessage` and `as unknown as NotificationRow[]` are spread across the code.
- **Why it matters:** A renamed column compiles cleanly and breaks at runtime.
- **Recommendation:** Pass the generated `Database` type to all three factories, then remove casts as they become unneeded.

### RISK-052 · Affected files: `src/app/(app)/[tenantSlug]/(base-layout)/`, `src/app/(app)/[tenantSlug]/portal/`, `src/app/not-found.tsx`

- **What is wrong:** There is no `not-found.tsx` under `(base-layout)` or `portal`. `notFound()` from ticket, customer, report, team, audit and portal request pages falls through to the root 404.
- **Why it matters:** A portal customer with a stale request link loses the tenant's branded header. They land on a page whose "Return home" link goes to your marketing site.
- **Recommendation:** Add `(base-layout)/not-found.tsx` linking to tickets, and `portal/not-found.tsx` linking to "Your requests".

### RISK-053 · Affected files: `src/app/error.tsx`

- **What is wrong:** The root error boundary does not call `Sentry.captureException`. The `(base-layout)` and `portal` boundaries do.
- **Why it matters:** An `error.tsx` does not catch errors thrown by the layout in its own segment. So client errors in `(base-layout)/layout.tsx` and `portal/layout.tsx` reach the root boundary and are never reported.
- **Recommendation:** Call `Sentry.captureException(error)` in its `useEffect`.

### RISK-054 · Affected files: `src/app/(app)/[tenantSlug]/account/billing/page.tsx:17-20`, `account/billing/loading.tsx:5`, `src/features/billing/components/billing-dashboard.tsx:60-67`

- **What is wrong:**
  - The page passes the `params` Promise into a client component.
  - `loading.tsx` imports the whole 957-line client dashboard and feeds it a fake `Promise.resolve({ tenantSlug: "" })`.
  - The page returns `notFound()` for both "not a billing admin" and transient errors.
  - `MODAL_BUTTON`, `MODAL_BUTTON_PRIMARY` and `PillTone` are declared again even though they already exist in `modal-buttons.ts` and `types/index.ts`.
- **Why it matters:** The loading skeleton ships the full dashboard bundle. A user without permission sees a 404 instead of the "no permission" card the plans page shows.
- **Recommendation:** Pass `tenantSlug: string`, render `<LoadingState />` from `./reuse`, check permission in the page, and import the shared constants.

### RISK-055 · Affected files: `src/features/billing/services/billing.service.ts:329`, `src/features/billing/actions/billing-actions.ts:157`

- **What is wrong:** `resumeUpgradeApproval` and `updatePaymentMethodAction` skip the billing-role check that the other billing actions run in Next. The Edge Function does enforce the role, so this is not exploitable today.
- **Why it matters:** If the Edge Function check is ever loosened, these two actions are open. They are also the odd ones out when reading the code.
- **Recommendation:** Add the same `getTenantIdBySlug` and `canManageTenantBilling` guard to both.

### RISK-056 · Affected files: `src/features/team/services/team.service.ts:712-718`

- **What is wrong:** `resendInvite` does not filter by staff roles. A direct call with a customer's invited membership id sends a staff "team_invitation" email labelled "Agent".
- **Why it matters:** A customer gets a misleading staff invite that points at the staff reset page. Their role does not change.
- **Recommendation:** Add `.in("role", [...STAFF_ROLES])` to the lookup.

### RISK-057 · Affected files: `src/features/team/services/team.service.ts:885-938`

- **What is wrong:** `changeMemberStatus` lets the server set an _invited_ member to Active. The UI never offers this.
- **Why it matters:** A crafted call marks someone active who never accepted. Their `joined_at` stays null, and they count as staff.
- **Recommendation:** Only allow Active from `disabled`.

### RISK-058 · Affected files: `src/features/onboarding/types/onboarding.ts:5`, `src/features/onboarding/components/invite-team.tsx:39-44, 141`, `onboarding-wizard.tsx:56, 120`

- **What is wrong:** The invite role type is `"Agent" | "Admin" | "Manager"`, but the Select stores `"agent" | "billing_admin" | "manager"`. `as` casts hide the mismatch.
- **Why it matters:** The type check protects nothing, and "Admin" can never be sent.
- **Recommendation:** Type it as `"agent" | "manager" | "billing_admin"` and drop the casts.

### RISK-059 · Affected files: `src/features/onboarding/actions/register-actions.ts:54-75`

- **What is wrong:** `checkEmailTenantAction` tells any anonymous caller whether an email has an account. The only limit is in memory, per server instance: 10 a minute per IP.
- **Why it matters:** Anyone can confirm which emails are customers of the product.
- **Recommendation:** Drop the pre-check and return the "already registered" message at submit time, or move the limit to a shared store.

### RISK-060 · Affected files: `src/features/sla-policies/service/sla.service.ts:100-162, 183-223, 1056-1064, 1209-1212, 1337-1341`

- **What is wrong:** These are fallback paths for migrations 20261002120000, 20261005120000 and 20261009120000, which are applied on live. The legacy `toLegacyTargetRow` writes "days" as 1440, which is wrong on today's schema.
- **Why it matters:** About 120 lines can never run. If a PGRST204 ever appears for another reason, they quietly write wrong targets.
- **Recommendation:** Delete them. Keep the PGRST202 fallbacks for 20261013120000 and 20261017120000, which are still pending on live.

### RISK-061 · Affected files: `src/features/audit/components/audit-log-view.tsx:252-257, 569-588` (uncommitted)

- **What is wrong:** "Show this user's events" can set the User filter to a customer or a removed user. That person is not in the dropdown, so the trigger shows blank. The details sheet body also renders `{selected && …}`, so it goes blank while it slides closed.
- **Why it matters:** Admins can't see which user filter is active, and an empty white panel animates out on every close.
- **Recommendation:** Add the selected actor to the options when it is missing. Keep the last selected event in state until the close animation ends.

### RISK-062 · Affected files: `src/features/customers/services/customers.service.ts:33-35`, `src/features/team/services/team.service.ts:404`

- **What is wrong:** Two identical `serverNow = cache(() => Date.now())` helpers exist.
- **Why it matters:** Each `cache()` is separate, so two components in one request can show different "now" values.
- **Recommendation:** Keep one in `src/lib/server-now.ts` and import it everywhere.

### RISK-063 · Affected files: `src/features/tickets/actions/tickets.actions.ts:176`

- **What is wrong:** `createTicketAction` reads `status` from the form data. The create sheet never sends one.
- **Why it matters:** A hand-made POST can create a ticket that starts as `resolved` or `closed`. That skips SLA clocks and opens a CSAT slot. Migration 20260926120000 closed this same hole for customers.
- **Recommendation:** Always create with `status: "new"`.

### RISK-064 · Affected files: `src/features/tickets/services/tickets.service.ts:409, 436-439, 658, 691`, `src/features/tickets/lib/sla.ts:144`

- **What is wrong:** `sla_tick` only warns when `notify_before_breach` is true. The ticket UI ignores that flag and colours tickets amber using `notify_before_mins` alone.
- **Why it matters:** A policy with warnings turned off still shows amber "warning" chips, but no warning notification is ever sent.
- **Recommendation:** Select `notify_before_breach` and use a lead time of 0 when it is false.

### RISK-065 · Affected files: `src/features/portal/components/portal-csat-card.tsx:76-97`, `src/features/portal/components/portal-check-email.tsx:46-63`

- **What is wrong:** Both `await` a server action with no try/finally.
- **Why it matters:** On a network failure, the rating and resend buttons spin forever until the page is reloaded.
- **Recommendation:** Wrap the call in try/catch/finally, like `portal-request-detail.tsx` does.

### RISK-066 · Affected files: `src/features/portal/components/portal-welcome-wizard.tsx:115-117`

- **What is wrong:** The welcome copy says "you'll see every request your team raises with us". The list and RLS only show the customer's own requests. The company is free text the customer types.
- **Why it matters:** Customers expect to see colleagues' tickets, then report them as "missing".
- **Recommendation:** Change the copy to "Every request you raise with us shows up here."

### RISK-067 · Affected files: `src/features/portal/services/portal.service.ts:1549, 1735-1737`

- **What is wrong:** `as unknown as {...}` casts and a hand-written `Array.isArray` reshape duplicate `one()`, which this file already imports.
- **Why it matters:** A schema change to the embed compiles fine and quietly returns `undefined`.
- **Recommendation:** Use `one()`, and narrow `schedule_json` with a type guard.

### RISK-068 · Affected files: `src/app/(app)/[tenantSlug]/(base-layout)/tickets/[ticketId]/page.tsx:27, 38`

- **What is wrong:** `ticketId` is not checked as a UUID before the query. The UUID regex now exists in three places.
- **Why it matters:** A malformed id reaches Postgres (22P02). It is logged as an error twice per hit, which is noise in Sentry.
- **Recommendation:** Share one `isUuid` helper and call `notFound()` early.

### RISK-069 · Affected files: `src/app/sitemap.ts:13`

- **What is wrong:** The sitemap lists `/about`, which does not exist. The proxy reads "about" as a tenant slug.
- **Why it matters:** Crawlers follow it to `/about/login` and index a login page for a tenant that doesn't exist.
- **Recommendation:** Remove the entry.

---

## 🧪 4. Required Test Cases

- **RISK-001** — Log in at `/{slug}/login?next=https://evil.example`. This should prove the browser stays on the app origin.
- **RISK-001** — Log in as a billing admin with `?next=/{slug}/tickets`. This should prove they land on the billing page, not on tickets.
- **RISK-002** — Sign up a new workspace and invite an email that already has an account in tenant A. This should prove no `active` membership is created in the new tenant.
- **RISK-002** — Repeat with an email that is only a portal customer elsewhere, then sign in as that user. This should prove the session's tenant is unchanged and no reset email was queued.
- **RISK-003** — Call `registerOnboardingAction` 4 times in 15 minutes from one IP. This should prove the 4th call is refused.
- **RISK-003** — Submit with 11 invites, and separately with confirmation pending. This should prove validation fails, and that no `email_jobs` row is queued before confirmation.
- **RISK-004** — Call the profile action with `email: "other@x.com"`. This should prove `users.email` is unchanged.
- **RISK-004** — Call it with `avatarUrl: "https://evil.example/p.gif"` and no file. This should prove `avatar_url` is unchanged.
- **RISK-005** — Upload `a.html` from the portal with type `text/html`. This should prove the upload is rejected.
- **RISK-005** — Upload `a.pdf` with a client-claimed type of `text/html` through the signed URL. This should prove the record step deletes the object and rejects it.
- **RISK-006** — As a portal customer, `insert` into `audit_logs` through PostgREST. This should prove the insert is denied.
- **RISK-006** — As an agent, insert `action = 'delete', entity = 'sla_policy'`. This should prove it is denied while `('login','user')` still succeeds.
- **RISK-007** — Schedule a cancellation, then open `/payment/cancel` with no token. This should prove `next_plan_id` and `cancel_at_period_end` are unchanged and PayPal `activate` is not called.
- **RISK-007** — Start an upgrade checkout, then return through `/payment/cancel?token=<that order>`. This should prove only the pending checkout is cleared.
- **RISK-008** — Set a Business subscription to `past_due` within its grace window. This should prove the audit log and reports stay unlocked.
- **RISK-008** — With the same tenant at 5 seats, invite a 6th member. This should prove the Business seat limit applies, not the Free limit.
- **RISK-009** — Type an internal note, blur the textarea and press `r`. This should prove the composer stays on "Internal note".
- **RISK-009** — With an empty composer, press `r`. This should prove the composer switches to public and gets focus.
- **RISK-010** — Focus the status Select trigger on a ticket and press `r`. This should prove the status is unchanged and the composer does not open.
- **RISK-010** — Focus a filter Select on the tickets list and press `n`. This should prove the create sheet does not open.
- **RISK-011** — Log in with "Remember me" off. This should prove the `sb-*` cookies have no `Expires`/`Max-Age`, before and after a token refresh through the proxy.
- **RISK-011** — Log out. This should prove every `sb-*` cookie is sent with `Max-Age=0`.
- **RISK-012** — Upload a 3 MB avatar from the staff profile modal. This should prove `avatar_url` is updated.
- **RISK-012** — Upload a 6 MB avatar. This should prove a visible error is shown.
- **RISK-013** — While signed in as user A, open an expired reset link for user B. This should prove the page shows "link expired" and no password form.
- **RISK-013** — Open a valid `?code=` link, then reload. This should prove the code is gone from the URL and no second exchange fails.
- **RISK-014** — Open the profile modal. This should prove there is no SLA email switch, or that it reflects `email.sla` from notification preferences.
- **RISK-014** — Turn SLA emails off in the Notification center, breach a ticket, and check `email_jobs`. This should prove no SLA email is queued.
- **RISK-015** — On a freshly provisioned tenant, create a ticket Friday 17:00 local and reply Monday 09:30. This should prove Reports count it as met.
- **RISK-015** — With a policy that has no calendar, reply after 25 wall-clock hours on a 24-hour target. This should prove Reports count it as missed.
- **RISK-016** — Create a Selected-customers policy (2 h) older than the default (8 h). Open the portal anonymously. This should prove it shows 8 h.
- **RISK-016** — Sign in as a customer assigned to that 2 h policy. This should prove the portal shows 2 h and that policy's hours.

## 🏁 5. Verdict

**CRITICAL.** The merge itself is clean: types compile, migrations are ordered, every RPC exists, and server-side role gating is consistent across features. The risk is in the seams between features. Duplicated flows have drifted (two login forms, two invite flows, two SLA calculators, two attachment pipelines), and several of those drifts are now security or billing bugs. Fix RISK-002 first. Anyone on the internet can currently attach an existing user to their own workspace as active staff. RISK-001, RISK-006 and RISK-007 should ship in the same pass.

## 📋 6. Risk Tracking Table

| Risk ID  | Priority | Risk (Short Description)                             | File                                                                   | Completed | Reason if Not Completed |
| -------- | -------- | ---------------------------------------------------- | ---------------------------------------------------------------------- | --------- | ----------------------- |
| RISK-001 | High     | Open redirect after tenant login                     | `src/features/auth/components/tenant-login-form.tsx`                   | No        | _Pending_               |
| RISK-002 | High     | Signup activates existing accounts without consent   | `src/features/onboarding/services/onboarding.service.ts`               | No        | _Pending_               |
| RISK-003 | High     | Signup unthrottled, unlimited invite emails          | `src/features/onboarding/actions/register-actions.ts`                  | No        | _Pending_               |
| RISK-004 | High     | Profile action trusts client email, avatar URL       | `src/service/user-service.ts`                                          | No        | _Pending_               |
| RISK-005 | High     | Portal attachments accept active HTML/SVG            | `src/features/portal/portal.ts`                                        | No        | _Pending_               |
| RISK-006 | High     | Any member can forge audit log rows                  | `supabase/schemas/policies/19_audit_logs.sql`                          | No        | _Pending_               |
| RISK-007 | High     | Cancel page reactivates scheduled cancellation       | `src/app/(app)/[tenantSlug]/payment/cancel/page.tsx`                   | No        | _Pending_               |
| RISK-008 | High     | past_due immediately locks paid features             | `src/features/team/types/team.ts`                                      | No        | _Pending_               |
| RISK-009 | High     | R shortcut turns internal note public                | `src/features/tickets/components/ticket-detail-view.tsx`               | No        | _Pending_               |
| RISK-010 | High     | Shortcuts change focused Select values               | `src/hooks/use-keyboard-shortcut.ts`                                   | No        | _Pending_               |
| RISK-011 | High     | Remember-me ignored; logout keeps cookies            | `src/lib/supabase/server.ts`                                           | No        | _Pending_               |
| RISK-012 | High     | Staff avatars over 1 MB fail silently                | `src/actions/user-actions.ts`                                          | No        | _Pending_               |
| RISK-013 | High     | Central reset page mishandles expired links          | `src/app/(auth)/reset-password/page.tsx`                               | No        | _Pending_               |
| RISK-014 | High     | Profile SLA email switch never saved                 | `src/components/shared/profile-modal.tsx`                              | No        | _Pending_               |
| RISK-015 | High     | Reports ignore business hours on Default SLA         | `src/features/reports/service/reports.service.ts`                      | No        | _Pending_               |
| RISK-016 | High     | Portal quotes another group's SLA policy             | `src/features/portal/services/portal.service.ts`                       | No        | _Pending_               |
| RISK-017 | Medium   | Reports re-implement SLA engine differently          | `src/features/reports/service/business-time.ts`                        | No        | _Pending_               |
| RISK-018 | Medium   | SLA day minutes trusted from stale client            | `src/features/sla-policies/components/sla-editor.tsx`                  | No        | _Pending_               |
| RISK-019 | Medium   | CSAT read swallows every error                       | `src/features/reports/service/reports.service.ts`                      | No        | _Pending_               |
| RISK-020 | Medium   | Payment buttons re-enable before redirect            | `src/features/billing/components/pricing-cards.tsx`                    | No        | _Pending_               |
| RISK-021 | Medium   | Scheduled downgrade leaves plans page stale          | `src/features/billing/actions/billing-actions.ts`                      | No        | _Pending_               |
| RISK-022 | Medium   | past_due shown as green Active                       | `src/features/billing/components/billing-dashboard.tsx`                | No        | _Pending_               |
| RISK-023 | Medium   | Billing page sequential queries, per-invoice signing | `src/features/billing/services/billing-dashboard.service.ts`           | No        | _Pending_               |
| RISK-024 | Medium   | Callback error text shown on login page              | `src/app/auth/callback/route.ts`                                       | No        | _Pending_               |
| RISK-025 | Medium   | Central reset skips revoked-member check             | `src/features/auth/services/auth.service.ts`                           | No        | _Pending_               |
| RISK-026 | Medium   | Signup loader can spin forever                       | `src/features/onboarding/components/onboarding-wizard.tsx`             | No        | _Pending_               |
| RISK-027 | Medium   | Skip still sends typed invites                       | `src/features/onboarding/components/onboarding-wizard.tsx`             | No        | _Pending_               |
| RISK-028 | Medium   | Settings history always empty for most users         | `src/features/notifications/services/notifications.service.ts`         | No        | _Pending_               |
| RISK-029 | Medium   | Audit RLS functions run per row                      | `supabase/migrations/20261021120000_audit_log_page.sql`                | No        | _Pending_               |
| RISK-030 | Medium   | Branding colours and logo toggle unused by portal    | `supabase/schemas/functions/09_get_tenant_by_slug.sql`                 | No        | _Pending_               |
| RISK-031 | Medium   | ESLint fails on audit service                        | `src/features/audit/services/audit.service.ts`                         | No        | _Pending_               |
| RISK-032 | Medium   | Portal search term restores cleared search           | `src/features/portal/components/portal-requests-list.tsx`              | No        | _Pending_               |
| RISK-033 | Medium   | Unused status counts; no tab fallback                | `src/app/(app)/[tenantSlug]/(base-layout)/tickets/(overview)/page.tsx` | No        | _Pending_               |
| RISK-034 | Medium   | Server accepts replies on closed tickets             | `src/features/tickets/actions/tickets.actions.ts`                      | No        | _Pending_               |
| RISK-035 | Medium   | Saved-view counts block ticket list paint            | `src/features/saved-view/services/saved-views.service.ts`              | No        | _Pending_               |
| RISK-036 | Medium   | Global handler toasts on every ?error=               | `src/components/shared/email-verification-handler.tsx`                 | No        | _Pending_               |
| RISK-037 | Medium   | Cross-tab logout handled twice                       | `src/lib/auth-broadcast.ts`                                            | No        | _Pending_               |
| RISK-038 | Medium   | Header search does nothing                           | `src/components/shared/layout/header-search.tsx`                       | No        | _Pending_               |
| RISK-039 | Medium   | Profile save failures silent; stale photo            | `src/components/shared/profile-modal.tsx`                              | No        | _Pending_               |
| RISK-040 | Medium   | Shell identity runs queries in series                | `src/lib/identity.ts`                                                  | No        | _Pending_               |
| RISK-041 | Medium   | Navigation inside state updater; leaked timer        | `src/app/(app)/[tenantSlug]/payment/cancel/page.tsx`                   | No        | _Pending_               |
| RISK-042 | Medium   | Site name duplicated in page titles                  | `src/app/(app)/[tenantSlug]/(base-layout)/reports/page.tsx`            | No        | _Pending_               |
| RISK-043 | Medium   | Root canonical inherited by all routes               | `src/app/layout.tsx`                                                   | No        | _Pending_               |
| RISK-044 | Medium   | Proxy redirects OG image to login                    | `src/proxy.ts`                                                         | No        | _Pending_               |
| RISK-045 | Low      | Plan gating uses three sources of truth              | `reports/types/types.ts`, `team.service.ts`, `entitlements.service.ts` | No        | _Pending_               |
| RISK-046 | Low      | Duplicated login, reset and invite flows             | `login-form.tsx`, `tenant-login-form.tsx`, `onboarding.service.ts`     | No        | _Pending_               |
| RISK-047 | Low      | Role and route rules copied everywhere               | `global-shortcuts.tsx`, `app-sidebar.tsx`, `role-route-guard.tsx`      | No        | _Pending_               |
| RISK-048 | Low      | Helpers duplicated across features                   | `tickets.service.ts`, `saved-view/filters.ts`, `feed.ts`               | No        | _Pending_               |
| RISK-049 | Low      | Dead email and notification code                     | `src/lib/email/send-email.ts`, `src/lib/notifications-shared.ts`       | No        | _Pending_               |
| RISK-050 | Low      | Unused tenant auth callback route                    | `src/app/(app)/[tenantSlug]/auth/callback/route.ts`                    | No        | _Pending_               |
| RISK-051 | Low      | Supabase clients missing Database type               | `src/lib/supabase/server.ts`, `client.ts`, `admin.ts`                  | No        | _Pending_               |
| RISK-052 | Low      | No scoped not-found pages                            | `src/app/(app)/[tenantSlug]/portal/`, `(base-layout)/`                 | No        | _Pending_               |
| RISK-053 | Low      | Root error boundary skips Sentry                     | `src/app/error.tsx`                                                    | No        | _Pending_               |
| RISK-054 | Low      | Billing page params, loading and constants           | `src/app/(app)/[tenantSlug]/account/billing/page.tsx`                  | No        | _Pending_               |
| RISK-055 | Low      | Two billing actions skip in-Next role check          | `src/features/billing/services/billing.service.ts`                     | No        | _Pending_               |
| RISK-056 | Low      | resendInvite accepts customer memberships            | `src/features/team/services/team.service.ts`                           | No        | _Pending_               |
| RISK-057 | Low      | Invited member can be set Active directly            | `src/features/team/services/team.service.ts`                           | No        | _Pending_               |
| RISK-058 | Low      | Onboarding role type mismatches values               | `src/features/onboarding/types/onboarding.ts`                          | No        | _Pending_               |
| RISK-059 | Low      | Anonymous email existence check                      | `src/features/onboarding/actions/register-actions.ts`                  | No        | _Pending_               |
| RISK-060 | Low      | Dead SLA migration fallbacks                         | `src/features/sla-policies/service/sla.service.ts`                     | No        | _Pending_               |
| RISK-061 | Low      | Audit user filter and sheet go blank                 | `src/features/audit/components/audit-log-view.tsx`                     | No        | _Pending_               |
| RISK-062 | Low      | serverNow helper defined twice                       | `customers.service.ts`, `team.service.ts`                              | No        | _Pending_               |
| RISK-063 | Low      | Create ticket trusts form status                     | `src/features/tickets/actions/tickets.actions.ts`                      | No        | _Pending_               |
| RISK-064 | Low      | UI ignores notify_before_breach flag                 | `src/features/tickets/services/tickets.service.ts`                     | No        | _Pending_               |
| RISK-065 | Low      | Portal rating/resend buttons can stick               | `src/features/portal/components/portal-csat-card.tsx`                  | No        | _Pending_               |
| RISK-066 | Low      | Welcome copy promises company-wide visibility        | `src/features/portal/components/portal-welcome-wizard.tsx`             | No        | _Pending_               |
| RISK-067 | Low      | Unsafe embed casts in portal SLA helpers             | `src/features/portal/services/portal.service.ts`                       | No        | _Pending_               |
| RISK-068 | Low      | Ticket id not validated before query                 | `src/app/(app)/[tenantSlug]/(base-layout)/tickets/[ticketId]/page.tsx` | No        | _Pending_               |
| RISK-069 | Low      | Sitemap lists missing /about page                    | `src/app/sitemap.ts`                                                   | No        | _Pending_               |

> Update the **Completed** column as you fix each item. If a risk will not be fixed, replace `_Pending_` with the reason (for example: "Deferred to Q3 — requires auth refactor" or "Accepted risk — internal admin page only").
