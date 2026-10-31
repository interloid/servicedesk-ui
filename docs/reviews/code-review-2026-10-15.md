# Code Review Report

- **Date:** 2026-10-15
- **Reviewer:** Claude Code (automated review)
- **Scope:** Reports module — `src/app/(app)/[tenantSlug]/(base-layout)/reports/`, `src/features/reports/` (components, service, types), plus the reports additions in `src/app/globals.css` · 10 files
- **Verdict:** NEEDS ATTENTION

---

Files reviewed: `reports/page.tsx`, `reports/loading.tsx`, `features/reports/types/types.ts`, `service/reports.service.ts`, `service/business-time.ts`, `components/reports-dashboard.tsx`, `components/ticket-performance-card.tsx`, `components/agent-performance-table.tsx`, `components/reports-skeleton.tsx`, `src/app/globals.css` (diff). Shared code read to confirm findings: `(base-layout)/layout.tsx`, `(base-layout)/error.tsx`, `settings/team/page.tsx`, `lib/tenancy.ts`, `components/shared/layout/app-sidebar.tsx`, `role-route-guard.tsx`, `sla-policies/service/sla.service.ts`, `supabase/config.toml`, `lib/supabase/database.types.ts`.

Checked and fine: `loading.tsx` is present; the parent `(base-layout)/error.tsx` catches thrown errors; `next/image` is not needed (no images); no `dangerouslySetInnerHTML`; no server secrets reach client components; `tsc --noEmit` is clean for the module.

## ⚡ 1. High-Risk Issues (Bugs, Security Leaks, Broken Logic)

### RISK-001 · `src/app/(app)/[tenantSlug]/(base-layout)/reports/page.tsx:15`

- **What is wrong:** The page never checks the caller's role. The sidebar hides Reports from agents, but nothing on the server stops them.
- **Why it matters:** `isTenantRouteAllowed` lets every role except `billing_admin` through, and `RoleRouteGuard` only acts on `billing_admin`. An agent who types `/reports` sees every colleague's name, email, SLA rate and CSAT score. The Team page already gates this way on the server for the same reason (`settings/team/page.tsx:28`).
- **Recommendation:** Gate on the server before any query runs, the same way the Team page does.
- **Minimal fix:**

```tsx
import { notFound } from "next/navigation";
import { getCallerRole } from "@/features/team/services/team.service";

const role = await getCallerRole();
if (role !== "Tenant Admin" && role !== "Manager") notFound();
```

### RISK-002 · `src/features/reports/service/reports.service.ts:81`

- **What is wrong:** `.limit(20_000)` cannot raise PostgREST's row ceiling. `supabase/config.toml:18` sets `max_rows = 1000`, and hosted Supabase defaults to 1000 too. The server cuts every query to 1000 rows without an error.
- **Why it matters:** The comment says the cap "makes the truncation visible". It does not. The `>= REPORT_ROW_CAP` warning (line 138) can never fire. A tenant with 1,200 tickets in range sees counts, medians and SLA percentages built from a random-looking subset. Messages are worse: they are ordered oldest first (line 118), so the newest messages are dropped. Tickets raised late in the period then look unanswered. Closed ones count as SLA misses.
- **Recommendation:** Move the aggregation into a Postgres RPC, or page through results with `.range()` until a short page comes back.
- **Minimal fix:**

```ts
const PAGE = 1000;
async function fetchAll<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}
// usage: fetchAll<TicketRow>((a, b) => supabase.from("tickets").select(...).eq(...).or(...).order("id").range(a, b))
```

### RISK-003 · `src/features/reports/service/reports.service.ts:115`

- **What is wrong:** The messages query does not filter on `visibility`. `buildFirstResponseByTicket` (line 404) and `buildFirstReplyByAgentAndTicket` (line 422) treat any agent message as a reply. That includes internal notes, which the customer never sees.
- **Why it matters:** An agent who writes an internal note "looking into this" in minute 2 marks the ticket as answered in minute 2. The customer may wait a day for the real reply. SLA attainment and median first response both come out better than reality. Managers make staffing calls on inflated numbers.
- **Recommendation:** Only count public messages.
- **Minimal fix:**

```ts
supabase
  .from("ticket_messages")
  .select("ticket_id, author_type, author_id, created_at, body")
  .eq("tenant_id", tenantId)
  .eq("visibility", "public")
  .gte("created_at", since);
```

### RISK-004 · `src/features/reports/service/reports.service.ts:131`

- **What is wrong:** Every query failure is logged and then treated as "no rows". The tickets error is logged (line 131). The messages error is never checked (line 136). SLA setup errors (line 510) leave every ticket "not covered by a policy". Membership and user lookups (lines 586, 596) ignore their errors.
- **Why it matters:** The parent `error.tsx` never sees the failure. A database timeout shows "No ticket activity yet" to a busy tenant. A failed messages query shows every closed ticket as an SLA miss. A failed policy query shows "No tickets to judge yet". The admin has no way to tell a broken page from a quiet week.
- **Recommendation:** Throw on any query error so the existing error boundary shows a retry screen. Keep the deliberate tolerance only for `csat_ratings` (missing table).
- **Minimal fix:**

```ts
for (const [name, res] of [
  ["tickets", ticketsRes],
  ["messages", messagesRes],
] as const) {
  if (res.error)
    throw new Error(`[reports] ${name} lookup failed: ${res.error.message}`);
}
// same in loadSlaSetup (line 510) and computeAgentLoad (lines 586, 596)
```

## ⚠️ 2. Medium-Risk Issues (Performance, Anti-patterns, Next.js Violations)

### RISK-005 · `src/features/reports/components/reports-dashboard.tsx:225`

- **What is wrong:** The range picker and Export button only render when `hasData` is true.
- **Why it matters:** A tenant with no open tickets picks "Last 7 days" during a quiet week. The page shows the empty state and the picker disappears. The only way back to 30 days or 12 months is editing the URL by hand.
- **Recommendation:** Always render the range picker. Hide only Export when there is nothing to export.
- **Minimal fix:**

```tsx
<div className="flex flex-wrap items-center gap-2">
  {hasData && <Button ... onClick={() => exportCsv(data)}>Export</Button>}
  <RangePicker range={data.range} onChange={changeRange} />
</div>
```

### RISK-006 · `src/features/reports/components/reports-dashboard.tsx:103`

- **What is wrong:** CSV cells are quoted but not guarded against formulas. Agent names come from `users.full_name`, which users set themselves.
- **Why it matters:** CSV injection — a spreadsheet runs any cell that starts with `=`, `+`, `-` or `@` as a formula. A user named `=HYPERLINK("https://evil.example","Click")` puts a live link or formula in the admin's Excel file.
- **Recommendation:** Prefix risky leading characters with a single quote before quoting.
- **Minimal fix:**

```ts
const cell = (c: string | number) => {
  const s = String(c);
  const safe = typeof c === "string" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
const csv = rows.map((r) => r.map(cell).join(",")).join("\n");
```

### RISK-007 · `src/features/reports/service/reports.service.ts:345`

- **What is wrong:** `since` is "now minus N days" to the minute. `buildTrend` floors it to the start of that day or month, but only tickets after `since` are loaded. The first bucket only holds a part of its day or month.
- **Why it matters:** The first bar always looks like a dip. On "Last 12 months" this is worst: the first month may cover only 1 day and shows almost zero. It sits next to a second bar with the same month name (e.g. "Oct 25" and "Oct 26"). Readers take the dip as a real drop in volume.
- **Recommendation:** Start `since` at the beginning of the first bucket, so every bar covers a full period.
- **Minimal fix:**

```ts
const raw = new Date(now.getTime() - REPORT_RANGES[range].days * DAY_MS);
const firstBucket = floorToBucket(raw, RANGE_GRANULARITY[range], timeZone);
// convert the local bucket start back to an instant (zonedInstant(firstBucket, "00:00", timeZone))
// and use that as sinceDate. Requires loading the SLA timezone before the ticket query.
```

### RISK-008 · `src/features/reports/service/reports.service.ts:115`

- **What is wrong:** The messages query selects the full `body` of every message in range. The body is only used to check that it is not blank.
- **Why it matters:** Each page load pulls every message text in the period from the database into the Node server. Long email replies make this megabytes per request, and it runs again on every range change. Once RISK-002 is fixed with paging, this grows with tenant size.
- **Recommendation:** Filter blanks in the query and drop `body` from the select.
- **Minimal fix:**

```ts
.select("ticket_id, author_type, author_id, created_at")
.eq("author_type", "agent")
.neq("body", "")
```

### RISK-009 · `src/features/reports/service/reports.service.ts:135`

- **What is wrong:** Query results are cast with `as TicketRow[]`, `as MessageRow[]` and `as CsatRow[]` onto hand-written interfaces that copy the schema.
- **Correction (fix pass):** `createSupabaseServerClient` has no `Database` generic, so query results are `any`. The casts do not discard real types — there are none. The actual risk is the hand-written copies drifting from the schema.
- **Why it matters:** If a column is renamed or its type changes, TypeScript stays silent. For example, `author_type` is an enum in the schema but `string` here, so a typo like `"Agent"` compiles. The bug only shows as wrong numbers on the page.
- **Recommendation:** Drop the casts and the duplicate interfaces. Derive row types from `Database["public"]["Tables"][...]["Row"]` with `Pick`.
- **Minimal fix:**

```ts
type TicketRow = Pick<
  Tables<"tickets">,
  | "id"
  | "status"
  | "priority"
  | "assignee_user_id"
  | "sla_policy_id"
  | "created_at"
  | "resolved_at"
  | "first_response_at"
>;
const allTickets = ticketsRes.data ?? [];
```

### RISK-010 · `src/features/reports/service/reports.service.ts:624`

- **What is wrong:** An agent's "median first reply" is timed from ticket creation, on the wall clock. The SLA column next to it uses business hours. The reply time ignores when the ticket was assigned to that agent.
- **Why it matters:** A ticket raised Friday evening and assigned on Monday morning shows a 2.5-day reply for the agent who answered within minutes of getting it. The agent table is used to judge people, so this lands on the wrong person. The two columns also disagree for the same ticket, which looks like a bug to readers.
- **Recommendation:** Label the column honestly ("since ticket opened"), or measure from assignment time and use the same clock as the SLA column.
- **Minimal fix:**

```ts
// same clock as tallySla:
const target = sets.slaSetup.targetFor(t);
return reply
  ? target?.calendar
    ? businessMinutesBetween(t.created_at, reply, target.calendar)
    : minutesBetween(t.created_at, reply)
  : null;
```

## 🏗️ 3. Architectural & Cross-File Findings

### RISK-011 · Affected files: `src/features/reports/service/reports.service.ts`, `src/features/reports/service/business-time.ts`, `supabase/migrations/20260812053000_reshape_sla_policies.sql` (`reports_overview`), SLA engine on `feature/tickets` (`20261009130000`/`20261009140000`)

- **Priority:** Medium — this causes wrong numbers, not just extra code.
- **What is wrong:** SLA met/missed is worked out a third time, in TypeScript. The database already has `reports_overview` (still granted to `authenticated`, still in `database.types.ts`, but no longer called). The ticket SLA engine on `feature/tickets` stamps real deadlines in triggers. It keeps the original deadline when priority is lowered and pauses on hold. This page knows none of those rules.
- **Why it matters:** Once `feature/tickets` merges, a ticket can show "breached" on the ticket page and "met" in Reports. Admins will trust neither. Every SLA rule change must be made in three places, and one will be missed. The unused RPC also stays callable by any signed-in user.
- **Recommendation:** After the SLA engine merges, read its stamped result (deadline and breach flag on the ticket) instead of recomputing. Drop `reports_overview` in a migration, or reuse it as the server-side aggregation for RISK-002.

### RISK-012 · Affected files: `reports-dashboard.tsx`, `ticket-performance-card.tsx`, `agent-performance-table.tsx`, `reports-skeleton.tsx`

- **What is wrong:** The card class string `gap-0 rounded-xl bg-card p-4 shadow-sm ring-1 sm:p-5` is copied into four places. The skeleton depends on matching it exactly (its own comment says so).
- **Why it matters:** A padding change in one card that misses the skeleton makes the page jump when data loads. That is the exact thing the skeleton was built to stop.
- **Recommendation:** Export one `REPORT_CARD` constant (or a small `ReportCard` wrapper) and use it in all four files.

## 🧪 4. Required Test Cases

| Risk ID  | Test                                                                                 | What it should prove                                                                           |
| -------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| RISK-001 | Sign in as an `agent`, request `/{slug}/reports` directly.                           | Response is 404. No report queries run (spy on `fetchReportsData`).                            |
| RISK-001 | Sign in as `manager`, then as `tenant_admin`, request the same URL.                  | Both get the dashboard; the gate does not block allowed roles.                                 |
| RISK-002 | Seed 1,500 tickets created in the last 30 days, request the 30-day report.           | `ticketsCreated` is 1500, not 1000.                                                            |
| RISK-002 | Seed 1,200 messages, with the first agent reply to ticket X as message #1,150.       | Ticket X has a first response and counts as met, not missed.                                   |
| RISK-003 | Ticket with an internal agent note at +2 min and a public reply at +3 h, 1 h target. | Ticket counts as SLA missed; median first response is 3h.                                      |
| RISK-003 | Ticket with only an internal note, then closed.                                      | Ticket has no first response and is counted as a miss.                                         |
| RISK-004 | Make the tickets query return an error.                                              | Page throws and `(base-layout)/error.tsx` renders; the "No ticket activity yet" card does not. |
| RISK-004 | Make only the messages query fail.                                                   | Page throws; SLA attainment is not shown as 0%.                                                |
| RISK-004 | Make the `csat_ratings` query fail (table missing).                                  | Page still renders, CSAT shows "No ratings yet" — the deliberate tolerance survives.           |

## 🏁 5. Verdict

**NEEDS ATTENTION.** The module is well organised. It has a matching skeleton, a URL-driven range and careful timezone and business-hours handling. But the numbers it shows cannot yet be trusted. Rows are silently cut at 1000, internal notes count as replies, and failed queries look like an empty workspace. Agents can also open the page by URL and see their colleagues' scores. Fix RISK-001 first, because it is a data-exposure issue and a three-line change. Then fix RISK-002 and RISK-003, which decide whether any figure on the page is correct.

## 📋 6. Risk Tracking Table

| Risk ID  | Priority | Risk (Short Description)                    | File                               | Completed | Reason if Not Completed                                                                                                                                                         |
| -------- | -------- | ------------------------------------------- | ---------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RISK-001 | High     | Agents can open reports by URL              | `reports/page.tsx`                 | Yes       | Server-side role gate (Tenant Admin / Manager), same as Team page. 2026-10-30: Agents now get a personal view; every query is scoped to their tickets and ratings on the server |
| RISK-002 | High     | 1000-row cap silently truncates report data | `service/reports.service.ts`       | Yes       | Paged with `.range()` to an empty page; 20k cap now real and logged                                                                                                             |
| RISK-003 | High     | Internal notes counted as first response    | `service/reports.service.ts`       | Yes       | Messages filtered to `visibility = public`                                                                                                                                      |
| RISK-004 | High     | Query errors shown as empty data            | `service/reports.service.ts`       | Yes       | Errors thrown to `error.tsx`; CSAT keeps missing-table tolerance                                                                                                                |
| RISK-005 | Medium   | Range picker hidden on empty period         | `components/reports-dashboard.tsx` | Yes       | Range picker always shown; Export still needs data                                                                                                                              |
| RISK-006 | Medium   | CSV export allows formula injection         | `components/reports-dashboard.tsx` | Yes       | Cells starting `= + - @` / tab / CR prefixed with `'`                                                                                                                           |
| RISK-007 | Medium   | First trend bar covers partial period       | `service/reports.service.ts`       | Yes       | Range starts on a bucket boundary in tenant timezone                                                                                                                            |
| RISK-008 | Medium   | Full message bodies fetched for blank check | `service/reports.service.ts`       | Yes       | `body` not fetched; agent + non-blank filtered in query                                                                                                                         |
| RISK-009 | Medium   | Casts discard generated Supabase types      | `service/reports.service.ts`       | Partly    | Row types now `Pick<Tables<…>>`; typing the shared client is app-wide, out of scope                                                                                             |
| RISK-010 | Medium   | Agent reply time ignores assignment, clock  | `service/reports.service.ts`       | Partly    | Now on the SLA clock; timing from assignment needs an assignment timestamp we do not store                                                                                      |
| RISK-011 | Medium   | SLA logic duplicated across DB and TS       | `service/reports.service.ts`       | No        | Deferred until `feature/tickets` (SLA engine) merges; dropping `reports_overview` needs a live migration                                                                        |
| RISK-012 | Low      | Card styles duplicated; skeleton drift risk | `components/reports-skeleton.tsx`  | Yes       | Shared `REPORT_CARD` in `components/styles.ts`                                                                                                                                  |

> Update the **Completed** column as you fix each item. If a risk will not be fixed, replace `_Pending_` with the reason (for example: "Deferred to Q3 — requires auth refactor" or "Accepted risk — internal admin page only").
