# Code Review Report

- **Date:** 2026-10-10
- **Reviewer:** Claude Code (automated review)
- **Scope:** Ticket feature — `src/features/tickets/`, `src/app/(app)/[tenantSlug]/(base-layout)/tickets/`, `src/hooks/use-realtime-*.ts` + `use-now.ts`, and the portal "support closed" additions (`src/features/portal/support-closed.ts`, `portal.service.ts`, `portal.actions.ts`, `portal-new-request-form.tsx`, `portal/requests/new/page.tsx`) · 29 files
- **Verdict:** NEEDS ATTENTION

---

All 27 items in `code-review-2026-10-10.md` were checked and are not re-reported. Two follow-ups from that report:

- The RISK-001 fix there is incomplete. Agent uploads are still saved with `uploaded_by: null`, which is part of RISK-001 below.
- RISK-024 there (a timer re-rendering the whole detail view) has partly come back through the new `useSupportClosed` hook. See RISK-016 below.

`csv-import.tsx` is still dead code. It is not re-reported because the earlier report accepted it.

## ⚡ 1. High-Risk Issues (Bugs, Security Leaks, Broken Logic)

**RISK-001** · `src/features/tickets/actions/tickets.actions.ts:184`

- **What is wrong:** A reply that has files but no text creates no message row. The file is saved with `message_id = null` and `uploaded_by = null`.
- **Why it matters:** The attachments RLS policy shows customers every file with `message_id IS NULL` (`supabase/schemas/policies/11_attachments.sql:52`). The portal treats those files as part of the customer's opening request. So an **internal note** that holds only a screenshot or a log is shown to the customer, with a working download link. A file-only public reply has a smaller problem: it shows up under the opening post instead of as a reply.
- **Recommendation:** Always create a message when files are attached, link each file to it, and record who uploaded it.
- **Minimal fix:**

```ts
// sendTicketMessageAction
const text =
  body.trim() || `Attached ${files.length} file${files.length > 1 ? "s" : ""}.`;
const message = await createMessage({
  tenantSlug,
  ticketId,
  authorType: "agent",
  authorId: user.id,
  body: text,
  visibility,
});
if (files.length > 0) {
  await uploadTicketAttachments({
    tenant: tenantSlug,
    ticketId,
    files,
    messageId: message.id,
  });
}
// uploadTicketAttachments: set uploaded_by: identity.id whenever messageId is set
```

**RISK-002** · `src/features/portal/components/portal-new-request-form.tsx:231` (also `support-closed-notice.tsx`, `ticket-sla-card.tsx`)

- **What is wrong:** The "Support is currently closed… resume support Monday at 10:00 AM" note is formatted during the server render. It uses `toLocaleTimeString`, so the time is in the **server's** timezone. `suppressHydrationWarning` only hides the warning. React keeps the server's text and never corrects it. The portal form never re-renders it.
- **Why it matters:** The server runs on UTC, as Vercel does by default. An IST customer then reads "Monday at 04:30 AM" instead of 10:00 AM. Near midnight, "today" and "tomorrow" can also be wrong. In the agent notice and the SLA card, the wrong time shows until the first timer tick: up to 60 seconds for the notice, 1 second for the card.
- **Recommendation:** Format clock- and timezone-dependent text only after the page has mounted in the browser.
- **Minimal fix:**

```tsx
const mounted = useSyncExternalStore(
  () => () => {},
  () => true,
  () => false,
);
// …
{
  mounted
    ? supportClosedFormMessage(supportClosed)
    : "Support is currently closed.";
}
```

## ⚠️ 2. Medium-Risk Issues (Performance, Anti-patterns, Next.js Violations)

**RISK-003** · `src/features/tickets/actions/tickets.actions.ts:184-203`

- **What is wrong:** The reply is saved first and the files are uploaded after. If an upload fails, the action returns an error, but the message is already saved.
- **Why it matters:** The composer keeps the text and shows "Failed to send reply". The agent clicks Send again, and the customer gets the reply twice, by email too.
- **Recommendation:** Delete the message when the upload fails, or return success with a warning.
- **Minimal fix:**

```ts
try {
  await uploadTicketAttachments({
    tenant: tenantSlug,
    ticketId,
    files,
    messageId: message.id,
  });
} catch (e) {
  await supabase.from("ticket_messages").delete().eq("id", message.id);
  throw e;
}
```

**RISK-004** · `src/features/tickets/actions/tickets.actions.ts:102-111`

- **What is wrong:** The ticket and its first message are saved before the files upload. If the upload throws, the sheet shows an error and stays open.
- **Why it matters:** The agent clicks "Create ticket" again, and a duplicate ticket is created.
- **Recommendation:** Delete the ticket when the upload fails, as `createPortalRequest` already does.
- **Minimal fix:**

```ts
try {
  await uploadTicketAttachments({
    tenant: tenantSlug,
    ticketId: newTicket.id,
    files,
  });
} catch (e) {
  await admin.from("tickets").delete().eq("id", newTicket.id);
  throw e;
}
```

**RISK-005** · `src/features/tickets/actions/tickets.actions.ts:65-83`

- **What is wrong:** `requesterCustomerId` is never checked against the current tenant. The `tickets_insert` RLS policy checks only `tenant_id` and the role. The seeded message is then written with the admin client, which skips RLS.
- **Why it matters:** A staff member who knows another tenant's customer id can file a ticket naming that customer. They can also post a "customer" message in that customer's name.
- **Recommendation:** Look the customer up, filtered by tenant, before inserting.
- **Minimal fix:**

```ts
const { data: cust } = await supabase
  .from("customers")
  .select("id")
  .eq("id", requesterCustomerId)
  .eq("tenant_id", tenantId)
  .maybeSingle();
if (!cust) return { error: "Customer not found." };
```

**RISK-006** · `src/features/tickets/actions/tickets.actions.ts:522-538`

- **What is wrong:** Bulk "Mark resolved" updates every selected ticket and always sends `resolved_at: now()`. That includes tickets that are already resolved or closed.
- **Why it matters:** A closed ticket goes back to Resolved but keeps its old `closed_at`. An already-resolved ticket gets a new `resolved_at`. That opens a second CSAT slot and restarts the auto-close timer.
- **Recommendation:** Skip finished tickets and let the trigger set the timestamp.
- **Minimal fix:**

```ts
// send only { status: "resolved" }, and:
query = query.not("status", "in", "(resolved,closed)");
```

**RISK-007** · `src/features/tickets/actions/tickets.actions.ts:472-519`

- **What is wrong:** Bulk priority calls `change_ticket_priority` once per ticket. The first error ends the loop. The tickets already changed stay changed, and `revalidatePath` is skipped.
- **Why it matters:** The agent sees "failed" while the list still shows old priorities. They retry and write duplicate audit entries.
- **Recommendation:** Catch errors per ticket, count failures, and always revalidate.
- **Minimal fix:**

```ts
for (const id of payload.ticketIds) {
  try {
    const r = await changeTicketPriority(id, payload.priority, payload.reason);
    if (r.changed) count++;
  } catch {
    failed++;
  }
}
revalidatePath(`/${payload.tenantSlug}/tickets`);
```

**RISK-008** · `src/features/tickets/services/tickets.service.ts:238-260`

- **What is wrong:** The status tab counts download every ticket's `status` and count them in JavaScript. `supabase/config.toml` caps responses at `max_rows = 1000`.
- **Why it matters:** Once a tenant has more than 1,000 tickets, the tab counts are silently wrong. Every page load also downloads every row.
- **Recommendation:** Use a head-only count per status, or a small `group by` RPC.
- **Minimal fix:**

```ts
await Promise.all(
  STATUSES.map((s) =>
    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", s),
  ),
);
```

**RISK-009** · `src/features/tickets/services/tickets.service.ts:187-213`, `tickets/page.tsx:29-30`

- **What is wrong:** `status` and `priority` from the URL are cast with `as` and never checked. Any query error returns `{ tickets: [] }`.
- **Why it matters:** A typed `?status=foo` or a database outage shows "Queue clear". Agents believe there is no work.
- **Recommendation:** Whitelist the URL values, and throw on a query error so `error.tsx` shows.
- **Minimal fix:**

```ts
const status = STATUSES.includes(raw as TicketStatus)
  ? (raw as TicketStatus)
  : undefined;
if (error) throw new Error(`Failed to load tickets: ${error.message}`);
```

**RISK-010** · `src/features/tickets/services/tickets.service.ts:148-153`

- **What is wrong:** `process_sla_breaches` is awaited before the list query on every load and every realtime refresh. Its `try/catch` never fires, because `supabase.rpc` returns `{ error }` instead of throwing.
- **Why it matters:** Every list view waits for one extra database round trip. Errors from that call are silently dropped.
- **Recommendation:** Remove the call now that pg_cron `sla_tick` runs, or run it in parallel and check `error`.
- **Minimal fix:**

```ts
const { error: slaErr } = await supabase.rpc("process_sla_breaches");
if (slaErr) console.error("[tickets] process_sla_breaches:", slaErr.message);
```

**RISK-011** · `src/features/tickets/actions/tickets.actions.ts:85-100`

- **What is wrong:** An agent-created ticket saves the description in `tickets.description`. It also posts the same text as a customer message.
- **Why it matters:** The portal shows `tickets.description` as the opening post and then lists messages. The customer sees their request twice in a row.
- **Recommendation:** Keep one copy. Drop the seeded message and render `ticket.description` as the first bubble in the agent view.
- **Minimal fix:**

```ts
// remove the createSystemCustomerMessage(...) block in createTicketAction
```

**RISK-012** · `src/features/tickets/components/ticket-detail-view.tsx:585`

- **What is wrong:** When "Assign to me" fails, the select rolls back to `ticket.assignee_id`, the value from first load, instead of `prev`.
- **Why it matters:** Suppose a teammate reassigned the ticket over realtime, and then your self-assign fails. The select shows the wrong owner.
- **Recommendation:** Roll back to `prev`, like the other branches.
- **Minimal fix:**

```tsx
setAssigneeId(prev);
```

**RISK-013** · `src/features/tickets/components/ticket-detail-view.tsx:336-343`

- **What is wrong:** The mention regex `@(name1|name2…)` has no word boundary after the name.
- **Why it matters:** "@Samantha" is saved as a mention of staff member "Sam" followed by "antha". Sam is notified by mistake, and the chip looks broken.
- **Recommendation:** Require a non-word character after the name.
- **Minimal fix:**

```ts
new RegExp(`@(${names.map(escapeRegExp).join("|")})(?![\\w])`, "gi");
```

**RISK-014** · `src/hooks/use-realtime-messages.ts:17`, `src/hooks/use-realtime-sla-events.ts:22`, `ticket-detail-view.tsx:240-257`

- **What is wrong:** Messages, SLA events, status, priority and assignee are seeded once with `useState(initial)`. Fresh server props are ignored after that.
- **Why it matters:** Supabase realtime does not replay events missed while the socket was down. After a laptop sleeps or the wifi drops, replies made in the gap never appear until a full reload. The agent may answer an out-of-date thread.
- **Recommendation:** Merge new props into state by id when they change. Or re-fetch when the channel re-subscribes.
- **Minimal fix:**

```ts
const [seen, setSeen] = useState(initial);
if (initial !== seen) {
  setSeen(initial);
  setMessages((prev) => {
    const ids = new Set(prev.map((m) => m.id));
    return [...prev, ...initial.filter((m) => !ids.has(m.id))];
  });
}
```

**RISK-015** · `src/features/tickets/actions/tickets.actions.ts:158` (UI lock at `ticket-detail-view.tsx:392`)

- **What is wrong:** The "Support is closed" composer lock exists only in the browser. `sendTicketMessageAction` never checks business hours.
- **Why it matters:** The check runs once a minute. A tab open at closing time stays unlocked for up to 60 seconds. A direct action call skips the lock entirely.
- **Recommendation:** If the lock is a rule, check `closedReason` on the server for the ticket's policy.
- **Minimal fix:**

```ts
if (closedReason(Date.now(), usableCalendar(policy?.calendar ?? null)))
  return {
    success: false,
    error: "Support is closed. Replies open at the next business opening.",
  };
```

**RISK-016** · `src/features/tickets/components/ticket-detail-view.tsx:291`

- **What is wrong:** `useSupportClosed` runs a 60-second timer inside the 1,269-line page component.
- **Why it matters:** The whole page, thread included, re-renders every minute on every business-hours ticket. This partly undoes RISK-024 from the earlier report.
- **Recommendation:** Move the timer into a small component around the composer, or schedule one timeout for the next opening or closing.
- **Minimal fix:**

```tsx
<SupportClosedGate calendar={slaPolicy?.calendar}>
  {(closed) => <Composer closed={closed} />}
</SupportClosedGate>
```

**RISK-017** · `src/features/portal/services/portal.service.ts:1609-1625`

- **What is wrong:** `getTicketSupportClosed` uses the policy's calendar. It ignores whether the first-response target itself counts business hours (`sla_events.business_hours_id`).
- **Why it matters:** Take a policy with a 24/7 first-response target. The customer is told "our team will resume Monday", while the SLA clock is already running.
- **Recommendation:** Return null when the ticket's first-response event has no `business_hours_id`.
- **Minimal fix:**

```ts
const { data: ev } = await admin
  .from("sla_events")
  .select("business_hours_id")
  .eq("ticket_id", ticketId)
  .eq("type", "first_response")
  .maybeSingle();
if (!ev?.business_hours_id) return null;
```

**RISK-018** · `src/features/tickets/components/tickets-table.tsx:565-575`

- **What is wrong:** The 300 ms search debounce calls an `updateQueryParam` captured on the keystroke render. That copy holds old `searchParams`. This is a stale closure: the function remembers an old value and keeps using it.
- **Why it matters:** The agent types "login", then picks Priority = Urgent within 300 ms. The timer fires and drops the Urgent filter. Back/forward also leaves the search box out of sync with the URL.
- **Recommendation:** Read the live URL when the timer fires.
- **Minimal fix:**

```ts
const params = new URLSearchParams(window.location.search);
value ? params.set("search", value) : params.delete("search");
params.set("page", "1");
router.replace(`${pathname}?${params}`);
```

**RISK-019** · `src/features/tickets/components/tickets-table.tsx:139-147`

- **What is wrong:** The selection resets only when the URL changes. A realtime `router.refresh()` keeps the URL, so rows that leave the list stay selected.
- **Why it matters:** "3 selected" can include a ticket no longer on screen. Bulk actions then change tickets the agent cannot see.
- **Recommendation:** Count only ids that are still in the list.
- **Minimal fix:**

```ts
const visible = new Set(initialTickets.map((t) => t.id));
const selected = selectedTicketIds.filter((id) => visible.has(id));
```

**RISK-020** · `src/features/tickets/components/tickets-table.tsx:245-266`

- **What is wrong:** `runBulkAction` runs inside `startTransition` with no `catch`. In React 19, an error thrown inside a transition goes to the nearest error boundary.
- **Why it matters:** A dropped connection during a bulk action replaces the tickets page with `error.tsx`, instead of the inline error message.
- **Recommendation:** Catch the error and set `bulkError`.
- **Minimal fix:**

```ts
} catch {
  setBulkError("Couldn't reach the server. Try again.");
} finally {
```

**RISK-021** · `src/features/tickets/components/tickets-table.tsx:743`, `:1000`

- **What is wrong:** An empty page past the end shows "Queue clear" and hides the pager. This happens after a bulk resolve or a realtime removal on page 2 or later.
- **Why it matters:** The agent thinks there is no work left, while page 1 still has tickets, and there is no way back.
- **Recommendation:** Jump to the last real page, or keep the pager visible when `currentPage > 1`.
- **Minimal fix:**

```tsx
if (initialTickets.length === 0 && currentPage > 1 && totalCount > 0)
  updateQueryParam("page", String(Math.max(1, totalPages)), true); // inside an effect
```

**RISK-022** · `src/features/tickets/components/create-ticket-sheet.tsx:323-335`

- **What is wrong:** The zone says "Drop files or browse" but has no drop handler. Picking files again replaces the earlier ones. `e.target.value` is never reset, so re-picking a removed file does nothing.
- **Why it matters:** Dropping a file makes the browser open it, and everything typed in the sheet is lost.
- **Recommendation:** Add drag handlers, append files instead of replacing them, and reset the input after each pick.
- **Minimal fix:**

```tsx
onDragOver={(e) => e.preventDefault()}
onDrop={(e) => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)); }}
// addFiles appends: setFiles((prev) => [...prev, ...picked]); then e.target.value = ""
```

**RISK-023** · `src/features/tickets/components/create-ticket-sheet.tsx:100-121`, `tickets.service.ts:1151`

- **What is wrong:** Every time the sheet opens, it fetches all customers with no limit. It renders them in a Select with no search box.
- **Why it matters:** With a few thousand customers, the sheet is slow to open and the requester is hard to find.
- **Recommendation:** Use a searchable combobox that queries with `ilike` and `.limit(50)`.
- **Minimal fix:**

```ts
.ilike("full_name", `%${q}%`).limit(50)
```

## 🏗️ 3. Architectural & Cross-File Findings

**RISK-024** · Affected files: `ticket-sla-card.tsx:94-97`

- **What is wrong:** The SLA card ticks every second while a clock is "waiting" outside business hours.
- **Why it matters:** Over a weekend the card re-renders every second for nothing. Each tick re-runs the multi-day calendar maths.
- **Recommendation:** Tick slowly while every clock is waiting, or set one timeout for `clock.startsAt`.

**RISK-025** · Affected files: `ticket-sla-card.tsx` (`SlaHeadlineBadge` and `TicketSlaCard`)

- **What is wrong:** The same waiting clock reads "Starts Mon 10:00 AM" in the header and "Paused — Outside business hours / Resumes Monday at 10:00 AM" on the card.
- **Why it matters:** The same state on the same screen uses two different wordings.
- **Recommendation:** Build the waiting text once in `computeSlaClock` and use it in both places.

**RISK-026** · Affected files: `ticket-tags-field.tsx`, `ticket-detail-view.tsx` (mention list), `tickets-table.tsx`

- **What is wrong:** Three keyboard suggestion lists each re-implement highlight, wrap-around, Enter/Escape and scroll handling. The tag list still uses the nearly invisible `bg-slate-50` highlight that was just fixed in the mention list.
- **Why it matters:** A fix to one list gets missed in the others. Arrow keys in tag suggestions show no visible selection.
- **Recommendation:** Extract a `useListNavigation` hook and a shared highlight class.

**RISK-027** · Affected files: `tickets/page.tsx:42-45`, `tickets-table.tsx:367-373`

- **What is wrong:** The page clamps the page number, but the table parses `?page=` again, raw.
- **Why it matters:** With `?page=2.5`, the server shows one page while the pager shows "2.5".
- **Recommendation:** Parse once on the server and pass `page` and `limit` down as props.

**RISK-028** · Affected files: `portal.service.ts:1586-1601`, `tickets.service.ts` (`CALENDAR_SELECT`, `toSlaCalendar`)

- **What is wrong:** `getPortalSupportClosed` copies `getDefaultPolicy`'s query. The portal service also now imports from the agent-side tickets service.
- **Why it matters:** If the default-policy ordering changes in one copy, the form note and the reply promise can point at different policies.
- **Recommendation:** Give `getDefaultPolicy` a select parameter. Move calendar parsing into `features/tickets/lib`.

**RISK-029** · Affected files: `portal.service.ts:1600`, `:1619-1623`; `tickets.service.ts:188`, `:192`, `:766`

- **What is wrong:** PostgREST embeds and rows are cast with `as`, for example `as CalendarJoin` and `data as Ticket`. The raw insert row has no `requester_name` or `sla_text`.
- **Why it matters:** TypeScript stops catching shape changes, and callers trust fields that are `undefined`.
- **Recommendation:** Narrow with the existing `one()` helper, and type insert results as the table `Row`.

**RISK-030** · Affected files: `lib/sla.ts:59-150`, `lib/sla.ts:210-274`

- **What is wrong:** `computeLiveSla` (the list) re-implements the waiting, warning and breach logic of `computeSlaClock` (the detail view).
- **Why it matters:** A fix to one is easily missed in the other, and then the list and detail badges disagree.
- **Recommendation:** Build `computeLiveSla` on top of `computeSlaClock`.

**RISK-031** · Affected files: `tickets.actions.ts:286-358`

- **What is wrong:** `updateTicketDetailsAction` does not check `status` against `STATUSES`. The `!== "unassigned"` branch can never run, because the client sends `unassign: true`.
- **Why it matters:** A bad value fails only at the database, and the agent sees the raw error. The dead branch misleads readers.
- **Recommendation:** Run `status` through `pick()` and remove the dead branch.

**RISK-032** · Affected files: `tickets.service.ts:1107`

- **What is wrong:** Storage names are `${Date.now()}-${ext}`. Two files with the same extension in the same millisecond collide, and `upsert: false` rejects the second.
- **Why it matters:** The whole send fails, which then triggers RISK-003.
- **Recommendation:** Use `crypto.randomUUID()` in the name.

## 🧪 4. Required Test Cases

- **RISK-001** — An agent sends an internal note with one file and no text. Prove the attachment row has a non-null `message_id` pointing to an internal message. Prove a select as the requester (through RLS) and the portal thread both return no file.
- **RISK-001** — An agent sends a public reply with one file and no text. Prove the file appears under the new reply in the portal, not under the opening post. Prove `uploaded_by` is the agent's id.
- **RISK-002** — Set the server to `TZ=UTC` and the tenant calendar to Asia/Kolkata, 10:00–19:00, on a Saturday. Load `/portal/requests/new` in an IST browser. Prove the note says "Monday at 10:00 AM", not 04:30 AM.
- **RISK-002** — Set the server clock to 23:50 UTC on a weekday, which is 05:20 the next day in IST. Prove the note says "today at 10:00 AM", not "tomorrow". Prove the agent notice and the SLA card show the same time on first paint.

## 🏁 5. Verdict

**NEEDS ATTENTION.** The ticket feature is well structured. Most of the risky logic, the SLA engine and the priority rules, lives in the database, where it is tested by triggers. The weak spots are the edges: what happens when a file upload or a network call fails halfway, and data shown before the browser takes over. Fix RISK-001 first: today, a file-only internal note is visible to the customer.

## 📋 6. Risk Tracking Table

| Risk ID  | Priority | Risk (Short Description)                     | File                          | Completed | Reason if Not Completed                                                                                                   |
| -------- | -------- | -------------------------------------------- | ----------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| RISK-001 | High     | File-only internal note visible to customer  | `tickets.actions.ts`          | Yes       | —                                                                                                                         |
| RISK-002 | High     | Closed-hours time uses server timezone       | `portal-new-request-form.tsx` | Yes       | —                                                                                                                         |
| RISK-003 | Medium   | Failed upload duplicates sent reply          | `tickets.actions.ts`          | Yes       | —                                                                                                                         |
| RISK-004 | Medium   | Failed upload duplicates created ticket      | `tickets.actions.ts`          | Yes       | —                                                                                                                         |
| RISK-005 | Medium   | Requester not checked against tenant         | `tickets.actions.ts`          | Yes       | —                                                                                                                         |
| RISK-006 | Medium   | Bulk resolve re-resolves finished tickets    | `tickets.actions.ts`          | Yes       | —                                                                                                                         |
| RISK-007 | Medium   | Bulk priority partial failure, no revalidate | `tickets.actions.ts`          | Yes       | —                                                                                                                         |
| RISK-008 | Medium   | Status counts capped at 1000 rows            | `tickets.service.ts`          | Yes       | —                                                                                                                         |
| RISK-009 | Medium   | Errors and bad filters show empty queue      | `tickets.service.ts`          | Yes       | —                                                                                                                         |
| RISK-010 | Medium   | Breach RPC blocks list, errors ignored       | `tickets.service.ts`          | Yes       | —                                                                                                                         |
| RISK-011 | Medium   | Customer sees description twice              | `tickets.actions.ts`          | Yes       | —                                                                                                                         |
| RISK-012 | Medium   | Assign-to-me failure rolls back wrongly      | `ticket-detail-view.tsx`      | Yes       | —                                                                                                                         |
| RISK-013 | Medium   | Mention regex matches name prefixes          | `ticket-detail-view.tsx`      | Yes       | —                                                                                                                         |
| RISK-014 | Medium   | Realtime gaps never resync from server       | `use-realtime-messages.ts`    | Yes       | —                                                                                                                         |
| RISK-015 | Medium   | Closed-hours reply lock is client-only       | `tickets.actions.ts`          | Yes       | —                                                                                                                         |
| RISK-016 | Medium   | Closed timer re-renders whole page           | `ticket-detail-view.tsx`      | Yes       | —                                                                                                                         |
| RISK-017 | Medium   | Closed message ignores 24/7 targets          | `portal.service.ts`           | No        | Not a bug — `sla_start_event` uses the policy calendar for every target, so message and clocks agree (documented in code) |
| RISK-018 | Medium   | Search debounce drops newer filters          | `tickets-table.tsx`           | Yes       | —                                                                                                                         |
| RISK-019 | Medium   | Selection keeps rows no longer listed        | `tickets-table.tsx`           | Yes       | —                                                                                                                         |
| RISK-020 | Medium   | Bulk action error crashes to error page      | `tickets-table.tsx`           | Yes       | —                                                                                                                         |
| RISK-021 | Medium   | Empty page past end hides pager              | `tickets-table.tsx`           | Yes       | —                                                                                                                         |
| RISK-022 | Medium   | Drop zone has no drop handler                | `create-ticket-sheet.tsx`     | Yes       | —                                                                                                                         |
| RISK-023 | Medium   | Requester picker loads every customer        | `create-ticket-sheet.tsx`     | Yes       | —                                                                                                                         |
| RISK-024 | Low      | SLA card ticks every second while waiting    | `ticket-sla-card.tsx`         | Yes       | —                                                                                                                         |
| RISK-025 | Low      | Waiting clock worded two different ways      | `ticket-sla-card.tsx`         | Yes       | —                                                                                                                         |
| RISK-026 | Low      | Suggestion list navigation duplicated thrice | `ticket-tags-field.tsx`       | No        | Partly — mention and tag lists share `useListNavigation`; tickets-table list not migrated yet                             |
| RISK-027 | Low      | Page number parsed twice, inconsistently     | `tickets-table.tsx`           | Yes       | —                                                                                                                         |
| RISK-028 | Low      | Default-policy query duplicated in portal    | `portal.service.ts`           | Yes       | —                                                                                                                         |
| RISK-029 | Low      | Unsafe casts on embeds and rows              | `tickets.service.ts`          | Yes       | —                                                                                                                         |
| RISK-030 | Low      | List SLA logic duplicates detail logic       | `lib/sla.ts`                  | No        | Partly — waiting/resume logic shared via `slaWaiting`; a full merge would change list badge text                          |
| RISK-031 | Low      | Status unvalidated; dead unassign branch     | `tickets.actions.ts`          | Yes       | —                                                                                                                         |
| RISK-032 | Low      | Upload names can collide                     | `tickets.service.ts`          | Yes       | —                                                                                                                         |

> Update the **Completed** column as you fix each item. If a risk will not be fixed, replace `_Pending_` with the reason (for example: "Deferred to Q3 — requires auth refactor" or "Accepted risk — internal admin page only").
