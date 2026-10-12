# Code Review Report

- **Date:** 2026-10-10
- **Reviewer:** Claude Code (automated review)
- **Scope:** Ticket feature only — `src/app/(app)/[tenantSlug]/(base-layout)/tickets/`, `src/features/tickets/` (actions, components, lib, services, types) and the hooks the ticket screens use (`use-realtime-ticket`, `use-realtime-tickets-refresh`, `use-realtime-sla-events`, `use-realtime-messages`, `use-now`). The tickets RLS policies, the `set_ticket_number` trigger and `getTenantIdBySlug` were read only to confirm findings. Other features were not reviewed. · 21 files
- **Verdict:** NEEDS ATTENTION

---

## ⚡ 1. High-Risk Issues (Bugs, Security Leaks, Broken Logic)

### RISK-001 · `src/features/tickets/services/tickets.service.ts:988`

- **What is wrong:** `uploadTicketAttachments` writes the file and the `attachments` row with the admin client. The admin client skips RLS (row-level security, the database rules that limit each user to their own tenant). Nothing checks that the caller is staff in the tenant, or that `ticketId` belongs to that tenant. `getTenantIdBySlug` also uses the admin client, so any slug resolves.
- **Why it matters:** `sendTicketMessageAction` only needs a signed-in user. With an empty body and one file, it skips the RLS-checked `createMessage` and goes straight to the admin upload. Any signed-in user, from any tenant, can drop a file into another tenant's ticket. The row has `message_id = null`, so the storage policy shows it to the ticket's customer as part of the opening post.
- **Recommendation:** Before the upload, confirm with the normal (RLS) client that the caller is staff and can see the ticket in this tenant.
- **Minimal fix:**

```ts
// uploadTicketAttachments, after tenantId is resolved
const supabase = await createSupabaseServerClient();
const { data: visible } = await supabase
  .from("tickets")
  .select("id")
  .eq("id", ticketId)
  .eq("tenant_id", tenantId)
  .maybeSingle();
if (!visible) throw new Error("Ticket not found.");
// and in sendTicketMessageAction, reject unless
// (await getCurrentUserIdentity(tenantId))?.role is tenant_admin / manager / agent
```

### RISK-002 · `src/features/tickets/services/tickets.service.ts:722`

- **What is wrong:** `createTenantTicket` counts the tenant's tickets and sends `number: count + 1`. The `set_ticket_number` trigger only fills `number` when it is null, so the app's guess is always used. The trigger's advisory lock is skipped.
- **Why it matters:** Delete one ticket and the count drops below the highest number. The next ticket gets a number that already exists. `uq_ticket_number` rejects the insert, and the agent sees "Failed to create ticket". Two agents creating a ticket at the same moment hit the same error.
- **Recommendation:** Drop the count query and do not send `number`; let the trigger assign it.
- **Minimal fix:**

```ts
const tenantId = await getTenantIdBySlug(tenant);
const { data, error } = await supabase
  .from("tickets")
  .insert([
    {
      ...ticketData,
      tenant_id: tenantId,
      status: ticketData.status || "new",
      priority: ticketData.priority || "normal",
    },
  ])
  .select()
  .single();
```

### RISK-003 · `src/features/tickets/components/create-ticket-sheet.tsx:299` (and `ticket-detail-view.tsx:264`)

- **What is wrong:** Files are sent inside the Server Action's `FormData`. Next.js caps a Server Action request at 1 MB by default, and `next.config` does not set `serverActions.bodySizeLimit`. The sheet says "up to 20 MB".
- **Why it matters:** Any attachment over about 1 MB is rejected before the action runs, so the action call fails. In the reply box, `handleSendReply` has `try/finally` with no `catch`, so the error goes to `error.tsx` and the page is replaced. The agent loses the reply they typed. In the create sheet, nothing happens and no error is shown.
- **Recommendation:** Raise the limit to match the promise and check file size on the server, or upload files straight to Storage from the browser.
- **Minimal fix:**

```ts
// next.config.ts
experimental: { serverActions: { bodySizeLimit: "20mb" } },
// ticket-detail-view.tsx handleSendReply
} catch {
  toast.error("Couldn't send — attachments may be too large.");
} finally {
```

### RISK-004 · `src/features/tickets/components/create-ticket-sheet.tsx:138`

- **What is wrong:** `handleSubmit` only handles `result.success`. When `createTicketAction` returns `{ error }`, the error is thrown away.
- **Why it matters:** The agent clicks "Create ticket", the spinner stops, and the sheet just stays open. They don't know if the ticket was created, so they click again. Some clicks then create duplicate tickets.
- **Recommendation:** Show the error with a toast, the same way the detail view does.
- **Minimal fix:**

```tsx
const result = await createTicketAction(tenant, formData);
if (result?.success) {
  resetForm();
  onOpenChange(false);
} else {
  toast.error(result?.error || "Failed to create ticket.");
}
```

### RISK-005 · `src/features/tickets/services/tickets.service.ts:148`

- **What is wrong:** The search text is pasted directly into a PostgREST `.or()` filter string. Commas, parentheses and dots have meaning in that string.
- **Why it matters:** Searching `login, password` or `error (500)` makes the query invalid. The error branch returns no rows, so the agent sees "Queue clear" even though matching tickets exist. A crafted search can also add its own filter conditions (RLS still limits it to the tenant).
- **Recommendation:** Remove or quote the special characters before building the filter.
- **Minimal fix:**

```ts
const term = search.replace(/[,()"\\]/g, " ").trim();
if (term) {
  query = query.or(`subject.ilike."%${term}%",description.ilike."%${term}%"`);
}
```

### RISK-006 · `src/features/tickets/services/tickets.service.ts:134`

- **What is wrong:** `countQuery` only filters by tenant. It ignores the status, priority and search filters that the row query uses.
- **Why it matters:** Filter to "Resolved" with 3 matches in a tenant of 120 tickets. The header says "120 total tickets" and "Showing 3 of 120". The next-page button stays enabled and leads to 14 empty pages.
- **Recommendation:** Get the count from the same filtered query.
- **Minimal fix:**

```ts
let query = supabase
  .from("tickets")
  .select(
    `*, customers:requester_customer_id (...), assignee:assignee_user_id (full_name)`,
    { count: "exact" },
  )
  .eq("tenant_id", tenantid);
// ...filters...
const { data, error, count } = await query
  .order(sortColumn, { ascending: sortAscending })
  .range(from, to);
const totalCount = count ?? 0;
```

### RISK-007 · `src/features/tickets/components/csv-import.tsx:44`

- **What is wrong:** The import wizard is a mock. It starts with a fake file ("zendesk-export-jul26.csv", 412 rows). It shows made-up totals (1,880 messages, 36 companies, 4 skipped rows). "Import 412 tickets" waits 800 ms and closes. The uploaded CSV is never read.
- **Why it matters:** A tenant admin moving from another help desk "imports" their history, sees it finish, and thinks the data is in. Nothing was saved. They may then delete the export from the old system.
- **Recommendation:** Hide the "Import from CSV" button, or mark the wizard as "Coming soon", until a real import exists.
- **Minimal fix:**

```tsx
// tickets-table.tsx
<Button variant="outline" size="sm" disabled title="Coming soon">
  Import from CSV
</Button>
```

---

## ⚠️ 2. Medium-Risk Issues (Performance, Anti-patterns, Next.js Violations)

### RISK-008 · `src/features/tickets/components/tickets-table.tsx:131`

- **What is wrong:** `selectedTicketIds` is never cleared when the page, filter or search changes.
- **Why it matters:** An agent selects 5 tickets on page 1, moves to page 2 and clicks "Mark resolved". The 5 tickets they can no longer see are resolved, and their customers get resolution emails.
- **Recommendation:** Clear the selection whenever the visible rows change.
- **Minimal fix:**

```tsx
const [rowsKey, setRowsKey] = useState(searchParams.toString());
if (rowsKey !== searchParams.toString()) {
  setRowsKey(searchParams.toString());
  setSelectedTicketIds([]);
}
```

### RISK-009 · `src/features/tickets/actions/tickets.actions.ts:292`

- **What is wrong:** `updateTicketDetailsAction` saves any `assigneeId` it receives. It does not check that the id is an active agent, manager or admin of this tenant. The tickets RLS policy only checks the caller, not the assignee.
- **Why it matters:** A crafted call can assign a ticket to a user from another tenant, and a `ticket_assigned` notification is created for them. That leaks the ticket subject and number outside the tenant.
- **Recommendation:** Look the id up in `fetchAssignableAgents` (or `memberships`) before saving.
- **Minimal fix:**

```ts
if (formData.assigneeId && !formData.unassign) {
  const agents = await fetchAssignableAgents(formData.tenantId);
  if (!agents.some((a) => a.id === formData.assigneeId))
    return { success: false, error: "Assignee is not on this team." };
}
```

### RISK-010 · `src/features/tickets/components/create-ticket-sheet.tsx:66`

- **What is wrong:** A `useEffect` writes a template into the description ("Hi — raising this from {company}. {subject}. Happy to send logs if that helps."). `createTicketAction` then posts the description as a **customer** message with the admin client.
- **Why it matters:** If the agent leaves the template in place, the thread and the portal show a message the customer never wrote, under the customer's name. Setting state from an effect also makes the form render twice on every keystroke.
- **Recommendation:** Use the template as a `placeholder`, not a value, so only text the agent writes is posted.
- **Minimal fix:**

```tsx
<Textarea
  placeholder={`Hi — raising this from ${company}. …`}
  value={description}
  onChange={(e) => setDescription(e.target.value)}
/>
// and delete the auto-description useEffect + autoDescriptionRef
```

### RISK-011 · `src/features/tickets/actions/tickets.actions.ts:46`, `:143`

- **What is wrong:** Values from `FormData` are cast with `as` instead of being checked. `status` allows `"solved"`, which is not a `TicketStatus`. `visibility` is `null` when missing, and TypeScript still treats it as `"public" | "internal"`.
- **Why it matters:** A bad value reaches the database and fails with a raw enum error. A reply sent without `visibility` is not `"public"`, so the assignee's notification is skipped without any warning.
- **Recommendation:** Check each value against a whitelist and fall back to a default.
- **Minimal fix:**

```ts
const v = formData.get("visibility");
const visibility: MessageVisibility = v === "internal" ? "internal" : "public";
const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
const p = String(formData.get("priority") ?? "");
const priority = (PRIORITIES as readonly string[]).includes(p)
  ? (p as TicketPriority)
  : "normal";
```

### RISK-012 · `src/features/tickets/components/ticket-detail-view.tsx:574` (also `ticket-lifecycle.tsx:9`, `ticket-sla-card.tsx:61`, `lib/sla.ts:155`, `tickets-table.tsx:126`, `hooks/use-now.ts:11`)

- **What is wrong:** Client Components are also rendered on the server. During that server render they format dates with `toLocaleTimeString` / `toLocaleString` in the server's time zone and locale. They also start the clock with `Date.now()`, so SLA text like "45s left" is computed at a slightly different moment on each side.
- **Why it matters:** When the server time zone differs from the browser's (e.g. UTC vs IST), the HTML does not match what the browser renders. This is a hydration mismatch, which React reports as an error and fixes by re-rendering on the client. Users briefly see times that are hours off.
- **Recommendation:** Format times only after mount (start `now` as `null` and fill it in an effect), or put `suppressHydrationWarning` on the time elements.
- **Minimal fix:**

```tsx
<span className="text-slate-400 text-xs" suppressHydrationWarning>
  {new Date(msg.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}
</span>
```

### RISK-013 · `src/features/tickets/components/ticket-detail-view.tsx:574`

- **What is wrong:** Each message shows only the hour and minute, never the date.
- **Why it matters:** On a ticket that has been open for a week, a reply from Monday and one from today both read "10:32". An agent can't tell how long the customer has been waiting.
- **Recommendation:** Add the date when the message is not from today.
- **Minimal fix:**

```tsx
new Date(msg.created_at).toLocaleString([], {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
```

### RISK-014 · `src/features/tickets/components/tickets-table.tsx:516`

- **What is wrong:** Every keystroke in the search box calls `router.push` with a new URL.
- **Why it matters:** Typing "password" sends 8 server renders and adds 8 history entries. Pressing Back steps through "passwor", "passwo" and so on. A slow response for "pass" can also arrive after the one for "password" and show the wrong results.
- **Recommendation:** Debounce the URL update by about 300 ms and use `router.replace`.
- **Minimal fix:**

```tsx
useEffect(() => {
  const id = setTimeout(() => updateQueryParam("search", searchQuery), 300);
  return () => clearTimeout(id);
}, [searchQuery]);
// updateQueryParam: router.replace(...) for "search"
```

### RISK-015 · `src/app/(app)/[tenantSlug]/(base-layout)/tickets/page.tsx:33`

- **What is wrong:** `page` and `limit` are taken from the URL with no bounds.
- **Why it matters:** `?limit=100000` loads every ticket along with its SLA events, policies and tags in one request, and the page hangs. `?page=-2` gives a negative range, and the list shows "Queue clear".
- **Recommendation:** Clamp `limit` to the offered values (8, 15, 25) and `page` to at least 1.
- **Minimal fix:**

```ts
const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
const limit = [8, 15, 25].includes(Number(sp.limit)) ? Number(sp.limit) : 8;
```

### RISK-016 · `src/features/tickets/services/tickets.service.ts:262`

- **What is wrong:** The list reads the warning lead with `||`, so a policy with `notify_before_mins = 0` falls back to 15 minutes. The detail page uses `??`, so it keeps 0.
- **Why it matters:** For a "no warning" policy, the queue turns the ticket amber 15 minutes before the deadline, but the ticket page does not. Agents see two different SLA states for the same ticket.
- **Recommendation:** Use `??` here too.
- **Minimal fix:**

```ts
const warnMins =
  (t.sla_policy_id ? warnByPolicy.get(t.sla_policy_id) : undefined) ??
  DEFAULT_SLA_WARN_MINS;
```

### RISK-017 · `src/features/tickets/components/ticket-detail-view.tsx:271`

- **What is wrong:** After sending, the row returned by the action is added to the thread. That row has no `author_name` or `author_initials`. If the realtime copy (which has the name) arrives after it, it is dropped as a duplicate.
- **Why it matters:** The agent's own new reply often shows "Agent" / "AG" instead of their name, until they reload the page.
- **Recommendation:** Fill in the name from `memberNameById[currentUserId]` before adding the row.
- **Minimal fix:**

```tsx
const name = currentUserId ? memberNameById[currentUserId] : undefined;
const msg = {
  ...(res.message as TicketMessage),
  author_name: name,
  author_initials: name
    ?.split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase(),
};
setMessages((prev) =>
  prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
);
```

### RISK-018 · `src/features/tickets/services/tickets.service.ts:973`

- **What is wrong:** Attachment links are signed for 1 hour, once, when the page renders. Realtime keeps the page live, so agents leave it open for hours.
- **Why it matters:** After an hour, every attachment link on an open ticket fails with an error from Storage. The page also makes one signing request per file; `createSignedUrls` does them all in one call.
- **Recommendation:** Sign in one batch, and re-sign when a link is clicked (or refresh the page data before the links expire).
- **Minimal fix:**

```ts
const { data: signed } = await supabase.storage
  .from("ticket-attachments")
  .createSignedUrls(
    attachments.map((a) => cleanPath(a.storage_path)),
    3600,
  );
```

### RISK-019 · `src/features/tickets/services/tickets.service.ts:950`

- **What is wrong:** `bulkUpdateTickets` returns `ticketIds.length`, not the number of rows actually changed. When RLS blocks the update, Supabase returns no error and 0 rows.
- **Why it matters:** A user without edit rights, or ids from another tenant, still get "success". The selection clears and nothing changed.
- **Recommendation:** Select the updated ids and return how many there are.
- **Minimal fix:**

```ts
const { data, error } = await supabase
  .from("tickets")
  .update({ ...updates, updated_at: new Date().toISOString() })
  .eq("tenant_id", tenantId)
  .in("id", ticketIds)
  .select("id");
if (error) throw new Error(`Failed to update tickets: ${error.message}`);
return data?.length ?? 0;
```

### RISK-020 · `src/features/tickets/components/tickets-table.tsx:326`, `:444`

- **What is wrong:** The "All open" tab adds up every status, including resolved and closed. Clicking it removes the status filter, so it also lists closed tickets.
- **Why it matters:** A manager sees "All open 120" when only 30 tickets need work, and closed tickets fill the working queue.
- **Recommendation:** Either rename the tab "All", or count and filter only new, open, pending and on hold.
- **Minimal fix:**

```tsx
const OPEN: TicketStatus[] = ["new", "open", "pending", "on_hold"];
const allOpenCount = OPEN.reduce((s, k) => s + (statusCounts[k] ?? 0), 0);
```

### RISK-021 · `src/app/(app)/[tenantSlug]/(base-layout)/tickets/page.tsx:14`, `[ticketId]/page.tsx:23`

- **What is wrong:** Neither ticket page exports `metadata` or `generateMetadata`.
- **Why it matters:** Every ticket tab in the browser has the same generic title. An agent with ten tickets open can't tell the tabs apart, and browser history shows a list of identical entries.
- **Recommendation:** Add a static title to the list and a `generateMetadata` with the number and subject to the detail page.
- **Minimal fix:**

```ts
export async function generateMetadata({ params }: TicketDetailPageProps) {
  const { ticketId } = await params;
  // reuse the ticket fetch (wrap it in React cache())
  return { title: `#${ticket.number} · ${ticket.subject}` };
}
```

---

## 🏗️ 3. Architectural & Cross-File Findings

### RISK-022 · Affected files: `src/features/tickets/services/tickets.service.ts`, `src/app/(app)/[tenantSlug]/(base-layout)/tickets/[ticketId]/page.tsx`

- **What is wrong:** `fetchAssignableAgents` and `fetchMentionableMembers` are the same query with the same roles. The detail page calls both, so it runs the same query twice on every load.
- **Why it matters:** When the rule for who can be assigned changes, only one copy will be updated, and the two lists will quietly drift apart.
- **Recommendation:** Keep one function. If the two lists really need to differ, pass the roles in as a parameter.

### RISK-023 · Affected files: `tickets.service.ts` (`withVisibleAssignee`, `getTicketMessages`), `ticket-detail-view.tsx` (3 places), `hooks/use-realtime-messages.ts`

- **What is wrong:** The "name → two initials" code is copied six times, with small differences (some drop empty parts, some don't).
- **Why it matters:** A name with a double space gives "J" in one place and "JD" in another. Fixing it means editing six places.
- **Recommendation:** Move one `initialsOf(name)` helper into `src/lib/` and use it everywhere.

### RISK-024 · Affected files: `tickets-table.tsx:126`, `ticket-detail-view.tsx:253`, `hooks/use-now.ts`

- **What is wrong:** The list starts its own `setInterval` instead of using `useNow`. The detail view calls `useNow(30_000)` at the top of the 1,000-line component, although `useNow`'s own comment says to keep it in the smallest component.
- **Why it matters:** The whole ticket page, including the thread and every Select, re-renders every 30 seconds just to update "last activity".
- **Recommendation:** Use `useNow` in both places, and move the "last activity" text into a small component of its own.

### RISK-025 · Affected files: `tickets.actions.ts`, `tickets.service.ts`, `ticket-detail-view.tsx`

- **What is wrong:** A field called `tenantId` holds the **slug** in the actions, in `createMessage` and in the reply `FormData`. In `getTicketMessages` and `fetchTicketSlaEvents`, `tenantId` is the UUID. `getTenantIdBySlug` is not wrapped in `cache()`, and one action resolves the same slug two to four times.
- **Why it matters:** Passing a UUID where a slug is expected fails silently. Each extra lookup is another admin round-trip on every reply and status change.
- **Recommendation:** Rename slug parameters to `tenantSlug`, resolve the id once per request, and wrap the resolver in React `cache()`.

### RISK-026 · Affected files: `tickets.actions.ts:33`, `tickets.types.ts:126`, `:142`, `:153`, `ticket-detail-view.tsx:158`, `lib/sla-calendar.ts:164`, `tickets-table.tsx:245`

- **What is wrong:** Several pieces of code are never used: `getTicketsAction`, `TicketFilters`, `TicketComment`, `SingleTicketDetail`, `mentionRef` (assigned but never read), `isWorkingTime`, and the `"solved"` status badge (not a real status).
- **Why it matters:** Readers think these are in use and keep them in step for no reason. `"solved"` also keeps the wrong status alive in `createTicketAction`.
- **Recommendation:** Delete them.

### RISK-027 · Affected files: `tickets/[ticketId]/page.tsx:29`, `tickets/page.tsx`, `tickets-table.tsx:781`, `ticket-detail-view.tsx:448`

- **What is wrong:** The list page loads its data through the service, but the detail page writes its own Supabase query inline. The table builds links as `` `/${tenant}/tickets/${id}` `` by hand, while the detail page uses `tenantPath(...)`.
- **Why it matters:** The ticket-shaping logic (requester name, company fallback) is now in two places and already differs: the list shows "Customer", the detail page shows the email. If routes change, the hand-built links break.
- **Recommendation:** Add a `fetchTicketById` to the service, and use `tenantPath` for every ticket link.

---

## 🧪 4. Required Test Cases

| Risk ID  | Test                                                                                                                   | Should prove                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| RISK-001 | Call `sendTicketMessageAction` as a user of tenant B with tenant A's slug, a tenant-A ticket id, empty body, one file. | Request is rejected; no storage object and no `attachments` row exist.  |
| RISK-001 | Call it as tenant A staff with a ticket id that belongs to tenant B.                                                   | Rejected with "Ticket not found"; nothing uploaded.                     |
| RISK-001 | Call it as a tenant A **customer** on their own ticket.                                                                | Rejected (agent action), file not stored.                               |
| RISK-002 | Create tickets #1–#3, delete #2, create a new ticket.                                                                  | New ticket succeeds and gets #4.                                        |
| RISK-002 | Fire two `createTicketAction` calls in parallel for one tenant.                                                        | Both succeed with different numbers.                                    |
| RISK-003 | Send a reply with a 5 MB PDF.                                                                                          | Reply and file are saved; page does not hit `error.tsx`.                |
| RISK-003 | Send a reply with a file above the configured limit.                                                                   | A toast explains the limit; typed text stays in the box.                |
| RISK-004 | Make `createTicketAction` return `{ error }` (e.g. RLS denial).                                                        | A toast shows the error; the sheet stays open with the form intact.     |
| RISK-004 | Double-click "Create ticket" after an error.                                                                           | Only one ticket is created once the error is fixed.                     |
| RISK-005 | Search `login, password`.                                                                                              | Tickets containing that text are listed; no PostgREST error.            |
| RISK-005 | Search `x%,status.eq.closed` and `error (500)`.                                                                        | Treated as plain text; no extra filter applied; no error.               |
| RISK-006 | Tenant with 120 tickets, 3 resolved; filter status = resolved.                                                         | Header says 3 total; "next page" is disabled.                           |
| RISK-006 | Search a term matching 10 tickets with limit 8.                                                                        | Total is 10 and there are exactly 2 pages.                              |
| RISK-007 | Open "Import from CSV".                                                                                                | Either disabled/"Coming soon", or the uploaded file's real rows appear. |
| RISK-007 | Upload a 3-row CSV and finish the wizard (once real).                                                                  | Exactly 3 tickets exist afterwards; no hard-coded 412.                  |

---

## 🏁 5. Verdict

**NEEDS ATTENTION.** The SLA engine wiring, realtime hooks and the detail view are careful and well commented. But the attachment upload lets any signed-in user write files into any tenant's tickets, and ticket creation breaks once any ticket is deleted. Fix RISK-001 first, then RISK-002.

---

## 📋 6. Risk Tracking Table

| Risk ID  | Priority | Risk (Short Description)                       | File                                                                   | Completed | Reason if Not Completed                                                                                                       |
| -------- | -------- | ---------------------------------------------- | ---------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| RISK-001 | High     | Admin upload skips tenant and ticket checks    | `src/features/tickets/services/tickets.service.ts`                     | Yes       | Fixed — upload checks staff role and that the ticket is the tenant's before the admin writes                                  |
| RISK-002 | High     | App-computed ticket number causes duplicates   | `src/features/tickets/services/tickets.service.ts`                     | Yes       | Fixed — app no longer sends `number`; `set_tickets_number` assigns it                                                         |
| RISK-003 | High     | 1 MB action limit breaks attachments           | `src/features/tickets/components/create-ticket-sheet.tsx`              | Yes       | Fixed — `bodySizeLimit`/`proxyClientMaxBodySize` 25mb, 20 MB total checked in browser and server, reply send catches failures |
| RISK-004 | High     | Create ticket errors silently ignored          | `src/features/tickets/components/create-ticket-sheet.tsx`              | Yes       | Fixed — action errors and failed requests show a toast                                                                        |
| RISK-005 | High     | Search text breaks PostgREST or-filter         | `src/features/tickets/services/tickets.service.ts`                     | Yes       | Fixed — commas, parentheses, quotes and backslashes stripped; ilike pattern quoted                                            |
| RISK-006 | High     | Total count ignores active filters             | `src/features/tickets/services/tickets.service.ts`                     | Yes       | Fixed — count comes from the filtered query (`count: "exact"`)                                                                |
| RISK-007 | High     | CSV import is fake, saves nothing              | `src/features/tickets/components/csv-import.tsx`                       | Yes       | Fixed — "Import from CSV" disabled as "Coming soon"; wizard kept, unwired, for the real import                                |
| RISK-008 | Medium   | Bulk selection survives page changes           | `src/features/tickets/components/tickets-table.tsx`                    | Yes       | Fixed — selection clears when page, filter or search changes                                                                  |
| RISK-009 | Medium   | Assignee not checked as tenant staff           | `src/features/tickets/actions/tickets.actions.ts`                      | Yes       | Fixed — assignee must be in `fetchAssignableAgents`                                                                           |
| RISK-010 | Medium   | Template posted as customer's message          | `src/features/tickets/components/create-ticket-sheet.tsx`              | Yes       | Fixed — template removed entirely (2026-10-11), not even as the placeholder; a neutral hint like the portal form; only typed text is posted as the customer                                            |
| RISK-011 | Medium   | Unchecked FormData casts                       | `src/features/tickets/actions/tickets.actions.ts`                      | Yes       | Fixed — `pick()` whitelists status/priority; visibility defaults to public                                                    |
| RISK-012 | Medium   | Server-rendered dates cause hydration mismatch | `src/features/tickets/components/ticket-detail-view.tsx`               | Yes       | Fixed — `suppressHydrationWarning` on clock/time text                                                                         |
| RISK-013 | Medium   | Message timestamps missing the date            | `src/features/tickets/components/ticket-detail-view.tsx`               | Yes       | Fixed — messages not from today show the date                                                                                 |
| RISK-014 | Medium   | Search navigates on every keystroke            | `src/features/tickets/components/tickets-table.tsx`                    | Yes       | Fixed — search debounced 300 ms and uses `router.replace`                                                                     |
| RISK-015 | Medium   | Unbounded page and limit params                | `src/app/(app)/[tenantSlug]/(base-layout)/tickets/page.tsx`            | Yes       | Fixed — page ≥ 1, limit limited to `TICKET_PAGE_SIZES`                                                                        |
| RISK-016 | Medium   | Zero warning lead becomes 15 minutes           | `src/features/tickets/services/tickets.service.ts`                     | Yes       | Fixed — `??` keeps a 0-minute lead                                                                                            |
| RISK-017 | Medium   | Own reply shows "Agent" not name               | `src/features/tickets/components/ticket-detail-view.tsx`               | Yes       | Fixed — sent reply gets the sender's name and initials                                                                        |
| RISK-018 | Medium   | Attachment links expire after one hour         | `src/features/tickets/services/tickets.service.ts`                     | Yes       | Fixed — one `createSignedUrls` call; page refreshes every 50 min while attachments exist                                      |
| RISK-019 | Medium   | Bulk update reports wrong count                | `src/features/tickets/services/tickets.service.ts`                     | Yes       | Fixed — returns rows actually updated; 0 rows is an error                                                                     |
| RISK-020 | Medium   | "All open" counts closed tickets               | `src/features/tickets/components/tickets-table.tsx`                    | Yes       | Fixed — tab renamed "All" (counts and filter unchanged)                                                                       |
| RISK-021 | Medium   | Ticket pages have no metadata titles           | `src/app/(app)/[tenantSlug]/(base-layout)/tickets/[ticketId]/page.tsx` | Yes       | Fixed — "Tickets" title; detail uses `#number · subject`                                                                      |
| RISK-022 | Low      | Duplicate agents and mentionable queries       | `src/features/tickets/services/tickets.service.ts`                     | Yes       | Fixed — `fetchMentionableMembers` removed; page passes agents to both                                                         |
| RISK-023 | Low      | Initials logic copied six times                | `src/features/tickets/components/ticket-detail-view.tsx`               | Yes       | Fixed — all ticket code uses `getInitials` from `src/lib/format.ts`                                                           |
| RISK-024 | Low      | Whole detail view re-renders every 30s         | `src/features/tickets/components/ticket-detail-view.tsx`               | Yes       | Fixed — list uses `useNow`; last-activity is its own component                                                                |
| RISK-025 | Low      | `tenantId` holds slug; repeated lookups        | `src/features/tickets/actions/tickets.actions.ts`                      | Yes       | Fixed — slug params renamed `tenantSlug`; `getTenantIdBySlug` wrapped in `cache()`                                            |
| RISK-026 | Low      | Dead code and unused types                     | `src/features/tickets/types/tickets.types.ts`                          | Yes       | Fixed — dead action, types, `mentionRef`, `isWorkingTime`, `"solved"` badge removed                                           |
| RISK-027 | Low      | Inline detail query and hand-built links       | `src/app/(app)/[tenantSlug]/(base-layout)/tickets/[ticketId]/page.tsx` | Yes       | Fixed — `fetchTicketById` in the service (cached); table links use `tenantPath`                                               |

> Update the **Completed** column as you fix each item. If a risk will not be fixed, replace `_Pending_` with the reason (for example: "Deferred to Q3 — requires auth refactor" or "Accepted risk — internal admin page only").
