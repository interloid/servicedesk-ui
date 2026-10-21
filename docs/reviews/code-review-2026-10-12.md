# Code Review Report

- **Date:** 2026-10-12
- **Reviewer:** Code review (pasted into Claude Code)
- **Scope:** `feature/tickets` PR — ticket UI, ticket actions/services, the DB-driven SLA engine and its migrations, SLA policy service, portal support-closed additions, onboarding time zone, `package.json`, `next.config.ts`
- **Verdict:** CRITICAL (fixed 2026-10-12, see the tracking table)

---

## ⚡ 1. High-Risk Issues (Bugs, Security Leaks, Broken Logic)

**RISK-001** · `supabase/schemas/policies/14_sla_events.sql:23-55`

- **What is wrong:** Every active member of a tenant can INSERT, UPDATE and DELETE any `sla_events` row in that tenant. Portal customers count, because they get an active customer membership. The policy predates this PR, but this PR makes `sla_events` the source of truth for SLAs. It also streams the table over realtime.
- **Why it matters:** A customer can call PostgREST with their portal token and delete any SLA clock, or set `status='completed'` on a breached one. An agent can quietly mark their own breaches as met. Realtime sends every ticket's due dates to every customer in the tenant.
- **Recommendation:** Only the engine should write `sla_events`. Only staff should read it.
- **Minimal fix:** drop the member INSERT/UPDATE/DELETE policies; add `public.current_tenant_role() in ('tenant_admin','manager','agent')` to SELECT; make `process_sla_breaches()` SECURITY DEFINER with `set search_path = public` and a `tenant_id = public.current_tenant_id()` filter.

**RISK-002** · `src/features/tickets/actions/tickets.actions.ts:293-324`, `supabase/schemas/policies/17_notifications.sql:4-46`

- **What is wrong:** Mention notifications are sent for internal notes too, and their payload holds the note text (`body: stripMentions(body).slice(0, 200)`). `ticket_created` / `ticket_updated` notifications hold ticket subjects. The schema file still lets every active tenant member, customers included, SELECT, INSERT, UPDATE and DELETE every notification in the tenant. The only fix is in `20260903090000_enable_realtime.sql`, and it covers SELECT only.
- **Why it matters:** A customer can read an internal note's text and other customers' ticket subjects with one REST call. Even with the migration, a customer can delete agents' notifications or insert fake `sla_breach` alerts. The next `supabase db diff` restores the tenant-wide SELECT.
- **Recommendation:** Scope every notifications policy to the recipient, in both the schema file and a migration. Leave the body out of internal-note notifications.

**RISK-003** · `src/features/tickets/actions/tickets.actions.ts:294-318`, `src/lib/mentions.ts:7`

- **What is wrong:** `extractMentionIds(body)` returns every UUID-shaped mention in the client's body. Each gets an admin-client insert that skips RLS. Nothing checks the id is this tenant's staff, and there is no cap.
- **Why it matters:** An agent can "mention" a customer's user id in an internal note and leak it. One huge body can fire hundreds of thousands of parallel service-role inserts.
- **Recommendation:** Keep only ids of this tenant's staff, cap the list, insert in one batch.

**RISK-004** · `supabase/migrations/20261008120000_ticket_sla_engine.sql:423-456`

- **What is wrong:** `20261009120000_sla_target_units.sql` stores targets as working minutes and makes `sla_target_mins()` a pass-through. The engine migration is dated earlier but runs later on live, putting back the old conversion; its backfill then restarts every open clock with it.
- **Why it matters:** An "8 days" target on 09:00-18:00 (4320) is read as 3 days (1620 min). Tickets breach days early.
- **Recommendation:** Re-date the PR migrations after `20261009120000`. Remove the conversion from the engine.

**RISK-005** · `supabase/migrations/20261008120000_ticket_sla_engine.sql:160, 283, 356, 466`

- **What is wrong:** SECURITY DEFINER helpers `sla_calendar`, `sla_add_seconds`, `sla_seconds_between`, `sla_resolve_policy` are callable by anon/authenticated via `/rest/v1/rpc` and do not check the caller's tenant.
- **Why it matters:** Cross-tenant read of calendars; `sla_seconds_between('0001-01-01','9999-12-31', id)` ties up a connection.
- **Recommendation:** Revoke execute on every internal helper.

**RISK-006** · `src/features/sla-policies/service/sla.service.ts:652-660, 724, 763`

- **What is wrong:** `assertCalendarNotInUse` refuses any change to hours, time zone or holidays once any `sla_events` row points at the calendar.
- **Why it matters:** After a tenant's first ticket nobody can add a holiday or fix a wrong time zone. The retime trigger (`20261010120000`) is unreachable.
- **Recommendation:** Remove the lock and let the retime trigger move running clocks.

**RISK-007** · `src/features/sla-policies/service/sla.service.ts:1268-1272`

- **What is wrong:** `updateSlaPolicy` throws `POLICY_IN_USE_MESSAGE` for any used policy, before looking at what changes.
- **Why it matters:** A used policy can never be set inactive, and its replacement cannot be activated.
- **Recommendation:** Lock only the fields that move deadlines (targets, business hours).

**RISK-008** · `supabase/migrations/20261008120000_ticket_sla_engine.sql:758-786`

- **What is wrong:** Clocks are paused only on status change. A clock started while the ticket is already Pending / On hold keeps running.
- **Why it matters:** The next `sla_tick()` breaches a ticket that is waiting on the customer.
- **Recommendation:** After starting or re-targeting clocks, pause them if the ticket is in a waiting status.

**RISK-009** · `supabase/migrations/20261010120000_business_hours_retime_sla.sql:131`

- **What is wrong:** When hours change, the target-units trigger resizes "days" targets, but the retime trigger re-lays each running clock with the old `v_event.target_mins`.
- **Why it matters:** 10-19 → 10-18: a running "1 day" clock keeps 540 minutes.
- **Recommendation:** Re-read the target from `sla_policy_targets` inside the loop and store it.

**RISK-010** · `ticket-detail-view.tsx:79-88, 803-808`; `ticket-lifecycle.tsx:10-17, 87-103`; `tickets-table.tsx:978-1023`

- **What is wrong:** Message times, the lifecycle banner and the queue's "Resumes …" use `toLocaleString` with `suppressHydrationWarning` but no `useMounted` gate, so the server's (UTC) text stays after hydration.
- **Why it matters:** Agents outside UTC see times off by their offset after a hard load.
- **Recommendation:** Render local times only after mount, as `ticket-sla-card.tsx` does.

## ⚠️ 2. Medium-Risk Issues (Performance, Anti-patterns, Next.js Violations)

**RISK-011** · `tickets.actions.ts` (all exported actions) — no runtime input validation; arrays uncapped, ids unchecked, text unbounded. Add a zod schema per action.

**RISK-012** · `tickets.service.ts` — services throw `Failed to … ${error.message}` and actions return it, leaking RLS/storage details. Log server-side, throw a fixed message.

**RISK-013** · `tickets.service.ts:218-226` — `.range()` past the last row returns PGRST103 (416) and the page errors instead of the table's "past the last page" redirect. Treat PGRST103 as an empty page.

**RISK-014** · `tickets.actions.ts:87-124` — the 20 MB attachment check runs after the ticket insert. Check before inserting.

**RISK-015** · `tickets.service.ts:1080-1089`; `create-ticket-sheet.tsx:279-290`; `ticket-detail-view.tsx:970-976` — no file-type allow-list, client-controlled content type, unsafe extension in the storage key, no file-count cap.

**RISK-016** · `next.config.ts` — the 25 MB body limit applies to every Server Action and the proxy. Upload straight to storage with signed upload URLs and keep the default limit.

**RISK-017** · `src/hooks/use-realtime-tickets-refresh.ts:26-58` — listeners have no tenant filter, the debounce can starve under a steady stream, no refresh on reconnect.

**RISK-018** · `ticket-detail-view.tsx:395-419` — the mention regex matches `@` inside an email address and hijacks Enter. Start a mention only at the start or after whitespace; use Unicode letters.

**RISK-019** · `tickets-table.tsx:143` — `useNow(30_000)` in the whole table re-renders every row every 30 s. Move the clock into a small SLA cell.

**RISK-020** · `ticket-detail-view.tsx:541`; `tickets-table.tsx:258` — `router.refresh()` after actions that already `revalidatePath`.

**RISK-021** · `tickets.service.ts:152-161` — every list render calls `process_sla_breaches()` (a DB write). Rely on `sla_tick()`.

**RISK-022** · engine migration `:935-1005`; retime migration `:122-129` — `sla_tick()` scans grow; missing partial indexes; warning window unbounded.

**RISK-023** · `src/features/portal/actions/portal.actions.ts:531, 591` — a failing support-closed lookup reports a saved request as failed.

**RISK-024** · `onboarding.service.ts:437-440`; `onboarding-wizard.tsx:63-66` — the time zone fallback is the alphabetically first zone, not UTC.

**RISK-025** · `package.json:26` — `date-fns` replaced by an unused `cn@^0.4.0`.

**RISK-026** · `tickets.service.ts:442-524` — `setTicketTags` does not check the ticket belongs to the tenant.

**RISK-027** · engine migration `:687-690` — `tickets_assign_sla_policy` keeps a client-sent `sla_policy_id` from another tenant.

## 🏗️ 3. Architectural & Cross-File Findings

**RISK-028** · September SLA migrations (`20260902000000`, `20260902090000`, `20260904000000`, `20260904010000`, `20261008110000`) — triggers created then dropped by the engine; `sla_breach` enum added twice.

**RISK-029** · `17_notifications.sql` vs `20260903090000_enable_realtime.sql` — schema file disagrees with the migration; realtime setup not in schema files.

**RISK-030** · `sla-calendar.ts`, `sla.ts`, `17_sla_engine.sql`, `20_ticket_priority_change.sql` — business-hours math duplicated in TS and SQL and drifted (inverted part-day holiday, `9:00` format, due-soon basis).

**RISK-031** · `csv-import.tsx` — unused mock code listed as a finished feature.

**RISK-032** · `tickets.service.ts:882-899` — PGRST202 fallback to a plain priority UPDATE skips the reason check and audit.

**RISK-033** · `tickets.actions.ts:391-406` — priority RPC and the follow-up field UPDATE are not atomic; a null tenant lookup can still report success.

**RISK-034** · `src/lib/mentions.ts:7`, `portal.service.ts:2588`, `mention-text.tsx` — `]` not escaped in mention markup (leaks user id to the portal); customers can type mention markup.

**RISK-035** · `portal.service.ts:2560-2574` — the opening-post dedupe can drop a real follow-up and its files.

**RISK-036** · `support-closed.ts:16-28`, `getPortalSupportClosed`, `portal/requests/new/page.tsx:36-41` — banner uses the default policy while the toast uses the ticket's; "today" judged in one zone, shown in another.

**RISK-037** · `ticket-detail-view.tsx`, `tickets-table.tsx`, `priority-reason-dialog.tsx:27` — labels/options duplicated; components over 1,100 lines; no `closed` status badge.

**RISK-038** · `ticket-tags-field.tsx`, `use-realtime-messages.ts:50`, `use-realtime-sla-events.ts:73-75` — tags never re-synced from props; message edits not streamed; SLA UPDATE for an unseen event dropped.

**RISK-039** · `src/lib/notifications.service.ts:92-104` — unused helpers; `markNotificationRead` has no owner check.

**RISK-040** · `tickets-table.tsx`, `create-ticket-sheet.tsx`, `use-list-navigation.ts` — missing accessible names, 6 links per row, drop zone without role/tab stop, `aria-selected` on non-options.

**RISK-041** · `sla.service.ts:631-650`; `tickets.service.ts:721` — per-calendar count queries; leftover debug `console.error`.

## 🧪 4. Required Test Cases

| Risk ID  | Test                                                                            | What it should prove                           |
| -------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| RISK-001 | Portal customer: `DELETE /rest/v1/sla_events?id=eq.<id>`                        | 0 rows deleted                                 |
| RISK-001 | Agent: PATCH a breached row to `completed`                                      | Refused                                        |
| RISK-001 | Customer token subscribes to realtime `sla_events`                              | No events reach the customer                   |
| RISK-002 | Agent posts internal note with a mention; customer `GET /rest/v1/notifications` | Empty                                          |
| RISK-002 | Customer `POST /rest/v1/notifications`                                          | Refused                                        |
| RISK-002 | `supabase db diff` after the fix                                                | No notifications policy change                 |
| RISK-003 | Reply mentioning a customer's user id                                           | No notification for that user                  |
| RISK-003 | Body with 1,000 mentions                                                        | ≤ one row per unique staff id, ≤ 50            |
| RISK-004 | Main applied, PR migrations with `--include-all`; "8 days" policy 09-18         | `target_mins = 4320`, due 8 working days later |
| RISK-004 | `select sla_target_mins(4320, <calendar>)`                                      | 4320                                           |
| RISK-005 | `rpc/sla_calendar` with anon key                                                | Permission denied                              |
| RISK-005 | `rpc/sla_seconds_between` as authenticated                                      | Permission denied                              |
| RISK-006 | Calendar with a met event; add a holiday                                        | Saved; running clocks re-timed                 |
| RISK-006 | UTC → Asia/Kolkata with a running clock                                         | Saved; `due_at` moves                          |
| RISK-007 | Used policy → inactive                                                          | Saved                                          |
| RISK-007 | Used policy → change a target                                                   | Refused                                        |
| RISK-008 | On-hold ticket gets a policy                                                    | New clock has `paused_at`                      |
| RISK-008 | Pending ticket, priority raised                                                 | Not breached by next tick                      |
| RISK-009 | Running "1 day" clock; hours 10-19 → 10-18                                      | `target_mins = 480`                            |
| RISK-009 | Change only holidays                                                            | `target_mins` unchanged                        |
| RISK-010 | UTC server, IST browser, hard reload                                            | Times show IST                                 |

## 🏁 5. Verdict

**CRITICAL.** Portal customers can write SLA data and read internal-note text. Out-of-order migrations shrink every day-based target on deploy. Two locks stop admins from editing calendars or used policies. Fix RISK-001 and RISK-002 first, then RISK-004.

## 📋 6. Risk Tracking Table

| Risk ID  | Priority | Risk (Short Description)                       | File                                           | Completed | Reason if Not Completed                                                                                                                                                           |
| -------- | -------- | ---------------------------------------------- | ---------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RISK-001 | High     | Customers can write and read SLA clocks        | `14_sla_events.sql`                            | Yes       | —                                                                                                                                                                                 |
| RISK-002 | High     | Internal notes leak through notifications      | `tickets.actions.ts`                           | Yes       | —                                                                                                                                                                                 |
| RISK-003 | High     | Mention ids unvalidated and uncapped           | `tickets.actions.ts`                           | Yes       | —                                                                                                                                                                                 |
| RISK-004 | High     | Engine migration shrinks day targets           | `20261009140000_ticket_sla_engine.sql`         | Yes       | Engine migrations re-dated to 20261009130000/20261009140000; sla_target_mins is a pass-through                                                                                    |
| RISK-005 | High     | SLA helpers callable by anon                   | `20261009140000_ticket_sla_engine.sql`         | Yes       | —                                                                                                                                                                                 |
| RISK-006 | High     | Calendar locked forever after first ticket     | `sla.service.ts`                               | Yes       | —                                                                                                                                                                                 |
| RISK-007 | High     | Used policy cannot be deactivated              | `sla.service.ts`                               | Yes       | —                                                                                                                                                                                 |
| RISK-008 | High     | Clocks started while waiting not paused        | `20261009140000_ticket_sla_engine.sql`         | Yes       | —                                                                                                                                                                                 |
| RISK-009 | High     | Retime keeps old working-day length            | `20261010120000_business_hours_retime_sla.sql` | Yes       | Scales the clock's own target instead of re-reading the policy, so a deadline kept by change_ticket_priority stays kept                                                           |
| RISK-010 | High     | Local times stuck on server time zone          | `ticket-detail-view.tsx`                       | Yes       | —                                                                                                                                                                                 |
| RISK-011 | Medium   | No runtime input validation on actions         | `tickets.actions.ts`                           | Yes       | Tags capped at 50 (not 20): the picker has no count limit and 20 could block edits on existing tickets                                                                            |
| RISK-012 | Medium   | Raw database errors shown to users             | `tickets.service.ts`                           | Yes       | —                                                                                                                                                                                 |
| RISK-013 | Medium   | Page past end shows error page                 | `tickets.service.ts`                           | Yes       | —                                                                                                                                                                                 |
| RISK-014 | Medium   | Attachment size checked after ticket insert    | `tickets.actions.ts`                           | Yes       | —                                                                                                                                                                                 |
| RISK-015 | Medium   | No attachment type allow-list                  | `tickets.service.ts`                           | Yes       | —                                                                                                                                                                                 |
| RISK-016 | Medium   | 25 MB limit on every Server Action             | `next.config.ts`                               | Partly    | Direct signed uploads would change the upload flow; limits lowered 25 MB → 21 MB (20 MB cap + form overhead). Next has no per-action limit                                        |
| RISK-017 | Medium   | Queue realtime unfiltered and can starve       | `use-realtime-tickets-refresh.ts`              | Yes       | —                                                                                                                                                                                 |
| RISK-018 | Medium   | Mention picker hijacks Enter after emails      | `ticket-detail-view.tsx`                       | Yes       | —                                                                                                                                                                                 |
| RISK-019 | Medium   | Whole table re-renders every 30 s              | `tickets-table.tsx`                            | Yes       | —                                                                                                                                                                                 |
| RISK-020 | Medium   | Duplicate server refresh after saves           | `ticket-detail-view.tsx`                       | Yes       | —                                                                                                                                                                                 |
| RISK-021 | Medium   | DB write on every list render                  | `tickets.service.ts`                           | Yes       | —                                                                                                                                                                                 |
| RISK-022 | Medium   | sla_tick scans grow; indexes missing           | `20261009140000_ticket_sla_engine.sql`         | Yes       | —                                                                                                                                                                                 |
| RISK-023 | Medium   | Saved portal request reported as failed        | `portal.actions.ts`                            | Yes       | —                                                                                                                                                                                 |
| RISK-024 | Medium   | Onboarding time zone falls back alphabetically | `onboarding.service.ts`                        | Yes       | Fixed in onboarding-wizard.tsx, where the fallback is chosen                                                                                                                      |
| RISK-025 | Medium   | date-fns removed; unused cn added              | `package.json`                                 | Yes       | —                                                                                                                                                                                 |
| RISK-026 | Medium   | Tags can attach to other tenant's ticket       | `tickets.service.ts`                           | Yes       | —                                                                                                                                                                                 |
| RISK-027 | Medium   | Ticket can use another tenant's policy         | `20261009140000_ticket_sla_engine.sql`         | Yes       | —                                                                                                                                                                                 |
| RISK-028 | Low      | Dead and duplicated September migrations       | `20260902000000_*.sql`                         | Partly    | September migrations are applied on live; deleting them breaks db push. Duplicate sla_breach enum add removed from the pending migration                                          |
| RISK-029 | Low      | Notifications policy drift in schema files     | `17_notifications.sql`                         | Yes       | —                                                                                                                                                                                 |
| RISK-030 | Low      | Business-hours math duplicated and drifted     | `sla-calendar.ts`                              | Partly    | Inverted part-day holidays and 9:00 format fixed in TS; merging TS/SQL math and the due-soon basis deferred                                                                       |
| RISK-031 | Low      | CSV import is unused mock code                 | `csv-import.tsx`                               | Yes       | —                                                                                                                                                                                 |
| RISK-032 | Low      | Priority fallback skips reason and audit       | `tickets.service.ts`                           | Yes       | —                                                                                                                                                                                 |
| RISK-033 | Low      | Priority and field updates not atomic          | `tickets.actions.ts`                           | Yes       | Priority must be sent on its own, so the RPC and the field update never run in one call; the assignee notification can still fail alone (logged)                                  |
| RISK-034 | Low      | Mention markup leaks user id to portal         | `mentions.ts`                                  | Yes       | —                                                                                                                                                                                 |
| RISK-035 | Low      | Opening-post dedupe can hide customer files    | `portal.service.ts`                            | Yes       | —                                                                                                                                                                                 |
| RISK-036 | Low      | Support-closed notice mixes policy and zone    | `support-closed.ts`                            | Yes       | The opening time is still shown in the visitor's zone, but the lead no longer says today; first-response text keeps the default policy (changing it changes customer-facing text) |
| RISK-037 | Low      | Duplicated labels; oversized components        | `ticket-detail-view.tsx`                       | Partly    | Shared labels/options and a closed badge done; splitting the 1,100-line components deferred                                                                                       |
| RISK-038 | Low      | Tags, edits and SLA updates go stale           | `ticket-tags-field.tsx`                        | Partly    | Tags re-sync, message UPDATEs and unseen SLA events done; a teammate's tag change during your own in-flight save can be lost                                                      |
| RISK-039 | Low      | Unused notification helpers lack owner check   | `notifications.service.ts`                     | Yes       | —                                                                                                                                                                                 |
| RISK-040 | Low      | Missing accessible names and roles             | `tickets-table.tsx`                            | Yes       | —                                                                                                                                                                                 |
| RISK-041 | Low      | Per-calendar count queries; debug log left     | `sla.service.ts`                               | Yes       | —                                                                                                                                                                                 |
