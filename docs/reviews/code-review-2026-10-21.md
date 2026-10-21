# Code Review Report

- **Date:** 2026-10-21
- **Reviewer:** Claude Code (automated review)
- **Scope:** Notification center — `src/features/notifications/`, `src/app/(app)/[tenantSlug]/(base-layout)/settings/notifications/`, `src/app/(app)/[tenantSlug]/(base-layout)/layout.tsx`, `src/components/shared/layout/notification-menu.tsx`, `src/lib/notifications.ts`, `src/types/notification.ts`, `supabase/schemas/policies/17_notifications.sql` · 13 files
- **Verdict:** NEEDS ATTENTION

---

## ⚡ 1. High-Risk Issues (Bugs, Security Leaks, Broken Logic)

### RISK-001 · `supabase/schemas/policies/17_notifications.sql:4`

- **What is wrong:** On `main`, the `notifications` policies let any active member read, update and delete every notification in the tenant. The fix is in `20260903090000_enable_realtime.sql`, but that migration exists only on `feature/tickets`. The same migration also adds the table to the realtime publication.
- **Why it matters:** The service code filters by `user_id`, but the database does not. Any agent can call PostgREST from the browser and read a coworker's notifications, which include ticket subjects and message previews. The agent can also mark them read or delete them. On a database built from `main`, the new realtime bell also gets no events, because the table is not in the publication.
- **Recommendation:** Bring `20260903090000_enable_realtime.sql` (and the own-rows UPDATE/DELETE policies from `20261012120000`) onto `main`, or merge `feature/tickets` first. Then confirm on live which of them is applied.
- **Minimal fix:**

```sql
-- policies/17_notifications.sql — scope every policy to the recipient
create policy "Members can view own Notifications" on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid())
         and tenant_id = (auth.jwt()->>'tenant_id')::uuid
         and public.is_active_membership());
-- same USING clause for UPDATE and DELETE; INSERT stays service-role only
alter table public.notifications replica identity full;
alter publication supabase_realtime add table public.notifications;
```

### RISK-002 · `src/features/notifications/components/notifications-provider.tsx:147`

- **What is wrong:** The bell only loads its list when the realtime channel reports `SUBSCRIBED`. Nothing loads it before that. If the channel never reaches `SUBSCRIBED`, the list stays `null`.
- **Why it matters:** The bell stays on "Loading notifications…" forever, and the badge stays at 0. Two cases trigger this:
  - A corporate proxy blocks WebSockets, or the channel ends in `CHANNEL_ERROR`/`TIMED_OUT`.
  - The provider remounts. React Strict Mode does this on every dev load. `removeChannel` is async, so `supabase.channel(sameName)` returns the old channel while it is still leaving. Calling `subscribe()` on it does nothing, and the callback never fires. Checked in `@supabase/realtime-js` 2.117.3: `RealtimeClient.channel()` reuses the channel by topic, and `subscribe()` only joins when the channel is closed.
- **Recommendation:** Load the list once on mount without waiting for the socket. Give each effect run its own channel name.
- **Minimal fix:**

```tsx
useEffect(() => {
  let active = true;
  loadNotificationsAction().then((res) => {
    if (active && res.ok && res.data) hydrate(res.data);
  });
  const supabase = createSupabaseClient();
  const channel = supabase
    .channel(`realtime-notifications-${userId}-${crypto.randomUUID()}`)
    // ...same .on(...) handlers...
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") void reload();
      if (status === "CHANNEL_ERROR") console.error("[notifications] realtime", err);
    });
  return () => {
    active = false;
    supabase.removeChannel(channel);
  };
}, [userId, reload, hydrate]);
```

## ⚠️ 2. Medium-Risk Issues (Performance, Anti-patterns, Next.js Violations)

### RISK-003 · `src/features/notifications/components/notifications-provider.tsx:175`

- **What is wrong:** When a save fails, `mutate` puts back the whole list as it was before that save. It throws away every change made since, including other saves that succeeded and realtime events.
- **Why it matters:** Suppose a user deletes B and marks A read at about the same time. If marking A read fails, B comes back on screen even though the server already deleted it. A notification that arrived in the meantime also disappears until the next reload.
- **Recommendation:** Undo only the one change that failed, not the whole list.
- **Minimal fix:**

```tsx
// setRead failure: flip only that row back
setNotifications((list) =>
  list?.map((n) => (n.id === id ? { ...n, unread: read } : n)) ?? list,
);
// remove failure: re-insert only the removed row
setNotifications((list) =>
  list && removed ? sortNewestFirst([removed, ...list]) : list,
);
```

### RISK-004 · `src/features/notifications/lib/feed.ts:103`

- **What is wrong:** `time` is formatted once, when the row is loaded. The page renders `item.time` (`notifications-view.tsx:611`, `:615`). Older dates use `toLocaleDateString` on the server, so they use the server's locale and time zone.
- **Why it matters:** If the page stays open for an hour, its rows still say "Just now". Rows older than a week show a date in the server's format, not the user's. The bell already uses `formatRelative(n.createdAt)` at render time, so the bell and the page show different times for the same row.
- **Recommendation:** Drop `time` from `NotificationFeedItem` and format `createdAt` where it is rendered. Do the same for settings history (`change.time`, line 565).
- **Minimal fix:**

```tsx
<span suppressHydrationWarning>{formatRelative(item.createdAt)}</span>
```

### RISK-005 · `src/features/notifications/lib/feed.ts:20`

- **What is wrong:** `ticket_updated` is the type created when someone replies on a ticket. It maps to the `"ticket"` feed type. Only `mention` maps to `"reply"`.
- **Why it matters:** The "Replies & mentions" filter never shows replies. A user looking for a customer's reply finds nothing under that filter.
- **Recommendation:** Map `ticket_updated` to `"reply"`.
- **Minimal fix:**

```ts
ticket_updated: "reply",
```

### RISK-006 · `src/components/shared/layout/notification-menu.tsx:74`

- **What is wrong:** The bell hides types whose In-app switch is off, but the page still lists them. The bell's "Mark all read" calls `markAllNotificationsReadAction()`, which also marks the hidden types read.
- **Why it matters:** The bell badge says 2, but the page says "Unread (5)". One click in the bell marks rows read that the user never saw, so the page's Unread tab empties without explanation.
- **Recommendation:** Pick one rule. Either the page also hides switched-off types, or the bell's "Mark all read" only marks the ids it shows.
- **Minimal fix:**

```tsx
// bell: only mark what the bell shows
onClick={() => visible.filter((n) => n.unread).forEach((n) => void setRead(n.id, true))}
```

### RISK-007 · `src/components/shared/layout/notification-menu.tsx:99`

- **What is wrong:** The bell trigger is a `<div role="button" tabIndex={0}>`. Browsers do not turn Enter or Space on a `div` into a click.
- **Why it matters:** Keyboard and screen-reader users can focus the bell but cannot open it.
- **Recommendation:** Use a real `<button>`.
- **Minimal fix:**

```tsx
<button type="button" className="relative flex size-10 sm:size-11 items-center justify-center rounded-md" aria-label={`Notifications, ${unread} unread`}>
```

### RISK-008 · `src/features/notifications/components/notifications-view.tsx:274`

- **What is wrong:** On the notifications page, the server component loads prefs and up to 200 notifications. On mount, the layout's provider also calls `loadNotificationsAction`, which runs the same two queries again.
- **Why it matters:** Every visit to this page runs the queries twice. The second result can also replace the first after the page has already rendered.
- **Recommendation:** Skip the provider's mount load when a page has already hydrated it, or let the page read from the provider and drop its own query.
- **Minimal fix:**

```tsx
// provider
const hydrated = useRef(false);
const hydrate = useCallback((data) => { hydrated.current = true; /* set state */ }, []);
// mount load: if (!hydrated.current) reload();
```

### RISK-009 · `src/features/notifications/actions/notifications.actions.ts:48`

- **What is wrong:** Each bell action (mark read, mark all read) calls `revalidatePath` on the notifications page. Per `node_modules/next/dist/docs/.../revalidatePath.md`, `revalidatePath` in a Server Function "causes all previously visited pages to refresh when navigated to again".
- **Why it matters:** One click in the bell from the tickets page throws away the cached copy of every page the user visited. Back-navigation then waits on fresh server renders.
- **Recommendation:** The provider already updates the screen, so only revalidate when the caller is the notifications page. Or move to `updateTag` for this data.
- **Minimal fix:**

```ts
export async function markNotificationReadAction(id: string, read = true, revalidate = false) {
  await markNotificationRead(id, read);
  if (revalidate) await revalidateNotifications();
  return { ok: true };
}
```

### RISK-010 · `src/features/notifications/components/notifications-provider.tsx:114`

- **What is wrong:** The realtime INSERT handler shows a toast whenever `prefsRef.current` is `null`, which means before prefs have loaded. It also shows one toast per row, with no limit.
- **Why it matters:** A user who turned off SLA alerts still gets SLA toasts during the first seconds after page load. When `sla_tick` inserts many warnings at once, the screen fills with toasts.
- **Recommendation:** Skip toasts until prefs are loaded. Group bursts into one toast.
- **Minimal fix:**

```tsx
const p = prefsRef.current;
if (p && isShownInApp(item, p)) {
  toast(item.title, { id: `notif-${item.kind}`, description: item.subtitle || undefined });
}
```

### RISK-011 · `src/features/notifications/services/notifications.service.ts:312`

- **What is wrong:** `listNotifications` returns at most 200 rows. The page's "Unread (N)" and the bell badge are both counted from those 200 rows.
- **Why it matters:** A user with more than 200 notifications sees an unread count that is too low. Older unread rows never appear and cannot be opened.
- **Recommendation:** Get the unread count from a separate `count: "exact", head: true` query. Page the list from the server instead of loading a fixed 200.
- **Minimal fix:**

```ts
const { count } = await supabase.from("notifications")
  .select("id", { count: "exact", head: true })
  .eq("tenant_id", actor.tenantId).eq("user_id", actor.userId).is("read_at", null);
```

## 🏗️ 3. Architectural & Cross-File Findings

### RISK-012 · Affected files: `src/features/notifications/components/notifications-view.tsx`, `src/components/shared/layout/notification-menu.tsx`

- **What is wrong:** There are two separate type-to-icon-and-colour maps: `notificationIcon` (view, line 143, `TONES`) and `itemLook` (menu, `TONE_TILE`). They already disagree. A reply shows `MessageSquare` in the bell but `Ticket` on the page.
- **Why it matters:** A new notification type has to be added in two places, so one gets missed. The same row then looks different in the bell and on the page.
- **Recommendation:** Move one `notificationLook(item)` into `features/notifications/lib/feed.ts` and use it in both places.

### RISK-013 · Affected files: `src/types/notification.ts`, `src/lib/notifications.ts`

- **What is wrong:** The `Notification` type (`types/notification.ts:5`) was the shape of the old mock list. Nothing uses it any more. Only `NotificationTone` is still imported.
- **Why it matters:** A developer may build on the dead type instead of `NotificationFeedItem`, which brings back a second notification shape.
- **Recommendation:** Delete `Notification`. Keep `NotificationTone` next to `TONE_TILE`.

### RISK-014 · Affected files: `src/features/notifications/components/notifications-provider.tsx`, `src/features/notifications/services/notifications.service.ts`

- **What is wrong:** Realtime rows are cast with `payload.new as NotificationRow`. Query rows are cast with `as unknown as NotificationRow[]` (service line 318). Neither cast is checked.
- **Why it matters:** If a column is renamed or the select list changes, TypeScript stays quiet. The feed then breaks at runtime: `row.type.replaceAll` throws on a missing `type`.
- **Recommendation:** Type the query from `Database["public"]["Tables"]["notifications"]["Row"]`, and add a small guard (`isNotificationRow`) before `toFeedItem` on realtime payloads.

## 🧪 4. Required Test Cases

- **RISK-001** — Sign in as agent A and insert a notification for agent B in the same tenant. Query `notifications` as A through PostgREST. This should prove A gets zero rows.
- **RISK-001** — As agent A, `update` and `delete` agent B's notification by id. This should prove both affect zero rows and B's row is unchanged.
- **RISK-001** — Subscribe to `postgres_changes` on `notifications` as A without a filter, then insert a row for B. This should prove A receives no event.
- **RISK-002** — Mount `NotificationsProvider` with a mocked realtime client that never calls back `SUBSCRIBED`. This should prove `notifications` still becomes a list from `loadNotificationsAction`.
- **RISK-002** — Mount, unmount and remount the provider within one tick (Strict Mode). Then insert a row. This should prove the remounted provider receives the INSERT and the bell leaves its loading state.
- **RISK-002** — Make the channel callback report `CHANNEL_ERROR`. This should prove the bell shows the loaded list and the error is logged.

## 🏁 5. Verdict

**NEEDS ATTENTION.** The feature structure is sound: one provider, server actions with typed results, and optimistic updates with clear error toasts. Two problems need fixing before release. The database on `main` still lets members read and change each other's notifications. The bell's first load depends on the WebSocket, so it can hang on "Loading…". Fix RISK-001 first, because it leaks data today, regardless of the new UI.

## 📋 6. Risk Tracking Table

| Risk ID  | Priority | Risk (Short Description)                      | File                                                        | Completed | Reason if Not Completed |
| -------- | -------- | --------------------------------------------- | ----------------------------------------------------------- | --------- | ----------------------- |
| RISK-001 | High     | Members can read others' notifications        | `supabase/schemas/policies/17_notifications.sql`            | No        | _Pending_               |
| RISK-002 | High     | Bell load waits on realtime subscribe         | `src/features/notifications/components/notifications-provider.tsx` | No        | _Pending_               |
| RISK-003 | Medium   | Failed save rollback erases other changes     | `src/features/notifications/components/notifications-provider.tsx` | No        | _Pending_               |
| RISK-004 | Medium   | Relative times frozen at load time            | `src/features/notifications/lib/feed.ts`                    | No        | _Pending_               |
| RISK-005 | Medium   | Replies missing from replies filter           | `src/features/notifications/lib/feed.ts`                    | No        | _Pending_               |
| RISK-006 | Medium   | Bell and page unread counts disagree          | `src/components/shared/layout/notification-menu.tsx`        | No        | _Pending_               |
| RISK-007 | Medium   | Bell not openable by keyboard                 | `src/components/shared/layout/notification-menu.tsx`        | No        | _Pending_               |
| RISK-008 | Medium   | Notifications page loads data twice           | `src/features/notifications/components/notifications-view.tsx` | No        | _Pending_               |
| RISK-009 | Medium   | Bell clicks purge all cached pages            | `src/features/notifications/actions/notifications.actions.ts` | No        | _Pending_               |
| RISK-010 | Medium   | Toasts ignore prefs before load               | `src/features/notifications/components/notifications-provider.tsx` | No        | _Pending_               |
| RISK-011 | Medium   | Unread count capped at 200 rows               | `src/features/notifications/services/notifications.service.ts` | No        | _Pending_               |
| RISK-012 | Low      | Duplicate icon and tone mappings              | `notifications-view.tsx`, `notification-menu.tsx`           | No        | _Pending_               |
| RISK-013 | Low      | Dead `Notification` type left behind          | `src/types/notification.ts`                                 | No        | _Pending_               |
| RISK-014 | Low      | Unchecked casts on notification rows          | `notifications-provider.tsx`, `notifications.service.ts`    | No        | _Pending_               |

> Update the **Completed** column as you fix each item. If a risk will not be fixed, replace `_Pending_` with the reason (for example: "Deferred to Q3 — requires auth refactor" or "Accepted risk — internal admin page only").
