"use client";

import * as React from "react";
import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  Bell,
  Box,
  CreditCard,
  Download,
  Eye,
  FileText,
  LayoutList,
  Loader2,
  Search,
  Shield,
  ShieldAlert,
  Timer,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination } from "@/components/shared/pagination";
import { formatRelativeTime, getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";

import { exportAuditLogAction } from "@/features/audit/audit-actions";
import { AuditDateRangePicker } from "@/features/audit/components/audit-date-range-picker";
import { AuditEventDetails } from "@/features/audit/components/audit-event-details";
import { AUDIT_ACTION_ICONS } from "@/features/audit/components/audit-icons";
import { AuditSettingsDialog } from "@/features/audit/components/audit-settings-dialog";
import {
  AUDIT_ACTION_BADGE,
  AUDIT_ACTION_FILTER_LABELS,
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_MODULE_BADGE,
  AUDIT_MODULE_LABELS,
  AUDIT_MODULES,
  AUDIT_PAGE_SIZES,
  AUDIT_RESULT_BADGE,
  AUDIT_RESULT_LABELS,
  AUDIT_RESULTS,
  AUDIT_SYSTEM_ACTOR,
  AUDIT_TAB_MODULES,
  auditFiltersToQuery,
  formatAuditTimestamp,
  type AuditEvent,
  type AuditFilters,
  type AuditModule,
  type AuditPageData,
} from "@/features/audit/types/audit";

const ALL = "all";

const TH =
  "h-11 px-4 text-xs font-semibold whitespace-nowrap text-muted-foreground";

const TAB_ICONS: Record<(typeof AUDIT_TAB_MODULES)[number], LucideIcon> = {
  authentication: Bell,
  team: Users,
  sla: Timer,
  billing: CreditCard,
  security: Shield,
};

type Draft = Pick<AuditFilters, "q" | "module" | "action" | "user" | "result">;

function draftOf(filters: AuditFilters): Draft {
  const { q, module, action, user, result } = filters;
  return { q, module, action, user, result };
}

/** An option for a User filter value that isn't one of data.users. */
function missingUserOption(
  user: string | null,
  data: AuditPageData,
  pinned: { value: string; label: string } | null,
): { value: string; label: string }[] {
  if (
    !user ||
    user === AUDIT_SYSTEM_ACTOR ||
    data.users.some((option) => option.id === user)
  ) {
    return [];
  }

  const label =
    (pinned?.value === user ? pinned.label : null) ??
    data.events.find((event) => event.actor?.id === user)?.actor?.name ??
    "Unknown user";

  return [{ value: user, label }];
}

/* ── Stat cards ─────────────────────────────────────────────────────────── */

function StatCard({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: LucideIcon;
  tone: string;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-4 rounded-[14px] border border-border bg-card p-4 shadow-xs sm:p-5">
      <span
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-xl",
          tone,
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-2xl font-bold tabular-nums">
          {value.toLocaleString("en-US")}
        </p>
        <p className="truncate text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export function AuditLogView({
  data,
  filters,
  timeZone,
  now,
  today,
  earliest,
}: {
  data: AuditPageData;
  filters: AuditFilters;
  timeZone: string;
  now: number;
  today: string;
  earliest: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNavigation] = useTransition();
  const [exporting, startExport] = useTransition();
  const [draft, setDraft] = React.useState<Draft>(() => draftOf(filters));
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const selected = data.events.find((event) => event.id === selectedId) ?? null;
  // The last opened event stays rendered while the sheet slides closed, so
  // the panel doesn't go blank mid-animation.
  const [shown, setShown] = React.useState<AuditEvent | null>(null);
  if (selected && selected !== shown) {
    setShown(selected);
  }
  // "Show this user's events" can pick a customer or a removed member, who is
  // not in data.users; remember their name so the User filter isn't blank.
  const [pinnedUser, setPinnedUser] = React.useState<{
    value: string;
    label: string;
  } | null>(null);
  const pageCount = Math.max(1, Math.ceil(data.total / filters.pageSize));

  const hrefFor = (next: Partial<AuditFilters>) => {
    const query = auditFiltersToQuery({ ...filters, page: 1, ...next });
    return query ? `${pathname}?${query}` : pathname;
  };

  const go = (next: Partial<AuditFilters>) => {
    startNavigation(() => router.push(hrefFor(next), { scroll: false }));
  };

  const apply = () => go({ ...draft, q: draft.q.trim() });

  const cleared: Draft = {
    q: "",
    module: null,
    action: null,
    user: null,
    result: null,
  };
  const clear = () => {
    setDraft(cleared);
    go(cleared);
  };

  const dirty =
    JSON.stringify({ ...draft, q: draft.q.trim() }) !==
    JSON.stringify(draftOf(filters));
  const anyFilter = Object.values(draftOf(filters)).some(Boolean);

  const selectTab = (module: AuditModule | null) => {
    setDraft((current) => ({ ...current, module }));
    go({ ...draftOf(filters), module });
  };

  const runExport = () => {
    startExport(async () => {
      const result = await exportAuditLogAction(auditFiltersToQuery(filters));

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      const url = URL.createObjectURL(
        new Blob([result.csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);

      toast.success(
        result.truncated
          ? `Exported the newest ${result.count.toLocaleString("en-US")} events. Narrow the filters to export the rest.`
          : `Exported ${result.count.toLocaleString("en-US")} ${result.count === 1 ? "event" : "events"}.`,
      );
      router.refresh();
    });
  };

  const firstRow =
    data.total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const lastRow = Math.min(filters.page * filters.pageSize, data.total);

  const showUserEvents = (event: AuditEvent) => {
    const user = event.actor?.id ?? AUDIT_SYSTEM_ACTOR;
    if (event.actor) {
      setPinnedUser({ value: event.actor.id, label: event.actor.name });
    }
    setSelectedId(null);
    setDraft({ ...draftOf(filters), user });
    go({ ...draftOf(filters), user });
  };

  return (
    <>
      <div className="h-full min-w-0 overflow-y-auto p-4 font-sans text-slate-900 sm:p-6 lg:p-8 dark:text-foreground">
        <div className="mx-auto flex w-full flex-col gap-6">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight">Audit log</h1>
                <Badge className="gap-1 border-none bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <ShieldAlert className="size-3" aria-hidden />
                  Business plan
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Track administrative and security-related activity across your
                workspace.
              </p>
            </div>

            <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
              <AuditDateRangePicker
                from={filters.from}
                to={filters.to}
                today={today}
                earliest={earliest}
                disabled={navigating}
                onChange={(from, to) => go({ from, to })}
                className="w-full sm:w-auto"
              />
              <Button
                variant="outline"
                className="h-10 flex-1 gap-2 rounded-lg bg-card px-4 text-sm font-semibold shadow-none sm:flex-none"
                onClick={runExport}
                disabled={exporting || data.total === 0}
              >
                {exporting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Download className="size-4" aria-hidden />
                )}
                Export
              </Button>
              <div className="flex-1 sm:flex-none *:w-full">
                <AuditSettingsDialog timeZone={timeZone} />
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <StatCard
              icon={FileText}
              tone="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
              label="Total events"
              value={data.summary.total}
            />
            <StatCard
              icon={Users}
              tone="bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
              label="Unique users"
              value={data.summary.users}
            />
            <StatCard
              icon={Box}
              tone="bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
              label="Modules tracked"
              value={data.summary.modules}
            />
            <StatCard
              icon={ShieldAlert}
              tone="bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300"
              label="Security events"
              value={data.summary.security}
            />
          </div>

          {/* Filters, tabs, table */}
          <div className="flex flex-col rounded-[14px] border border-border bg-card shadow-xs">
            <form
              className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:flex xl:flex-wrap xl:items-center"
              onSubmit={(event) => {
                event.preventDefault();
                apply();
              }}
            >
              <div className="relative sm:col-span-2 lg:col-span-3 xl:w-72 xl:flex-none 2xl:w-80">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={draft.q}
                  onChange={(event) =>
                    setDraft({ ...draft, q: event.target.value })
                  }
                  placeholder="Search by user, action, details…"
                  aria-label="Search audit events"
                  maxLength={100}
                  className="h-10 rounded-lg pl-9"
                />
              </div>

              <FilterSelect
                label="Module"
                value={draft.module}
                allLabel="All modules"
                options={AUDIT_MODULES.map((value) => ({
                  value,
                  label: AUDIT_MODULE_LABELS[value],
                }))}
                onChange={(module) =>
                  setDraft({ ...draft, module: module as AuditModule | null })
                }
              />
              <FilterSelect
                label="Action"
                value={draft.action}
                allLabel="All actions"
                options={AUDIT_ACTIONS.map((value) => ({
                  value,
                  label: AUDIT_ACTION_FILTER_LABELS[value],
                }))}
                onChange={(action) =>
                  setDraft({ ...draft, action: action as Draft["action"] })
                }
              />
              <FilterSelect
                label="User"
                value={draft.user}
                allLabel="All users"
                options={[
                  ...data.users.map((user) => ({
                    value: user.id,
                    label: user.name,
                  })),
                  ...missingUserOption(draft.user, data, pinnedUser),
                  { value: AUDIT_SYSTEM_ACTOR, label: "System" },
                ]}
                onChange={(user) => setDraft({ ...draft, user })}
              />
              <FilterSelect
                label="Result"
                value={draft.result}
                allLabel="All results"
                options={AUDIT_RESULTS.map((value) => ({
                  value,
                  label: AUDIT_RESULT_LABELS[value],
                }))}
                onChange={(result) =>
                  setDraft({ ...draft, result: result as Draft["result"] })
                }
              />

              <div className="flex gap-3 sm:col-span-2 lg:col-span-1 xl:ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 flex-1 rounded-lg px-4 font-semibold shadow-none xl:flex-none"
                  onClick={clear}
                  disabled={navigating || (!anyFilter && !dirty)}
                >
                  Clear
                </Button>
                <Button
                  type="submit"
                  className="h-10 flex-1 rounded-lg bg-brand-accent px-5 font-semibold text-brand-accent-foreground shadow-none hover:bg-brand-accent/90 xl:flex-none"
                  disabled={navigating || !dirty}
                >
                  Apply
                </Button>
              </div>
            </form>

            <nav
              aria-label="Modules"
              // overflow-x alone makes overflow-y auto too, and the tabs'
              // -mb-px then shows a vertical scrollbar beside them.
              className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border px-4 scrollbar-none"
            >
              <TabButton
                active={filters.module === null}
                onClick={() => selectTab(null)}
                icon={LayoutList}
                label="All events"
                count={data.tabCounts.all}
              />
              {AUDIT_TAB_MODULES.map((module) => (
                <TabButton
                  key={module}
                  active={filters.module === module}
                  onClick={() => selectTab(module)}
                  icon={TAB_ICONS[module]}
                  label={AUDIT_MODULE_LABELS[module]}
                  count={data.tabCounts[module]}
                />
              ))}
            </nav>

            <div
              className={cn(
                "overflow-x-auto transition-opacity",
                navigating && "pointer-events-none opacity-60",
              )}
              aria-busy={navigating}
            >
              <Table className="min-w-270">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className={TH}>
                      <span className="flex items-center gap-1">
                        Date &amp; time
                        <ArrowDown
                          className="size-3.5"
                          aria-label="newest first"
                        />
                      </span>
                    </TableHead>
                    <TableHead className={TH}>User</TableHead>
                    <TableHead className={TH}>Action</TableHead>
                    <TableHead className={TH}>Module</TableHead>
                    <TableHead className={TH}>Details</TableHead>
                    <TableHead className={TH}>Result</TableHead>
                    <TableHead className={TH}>IP address</TableHead>
                    <TableHead className={cn(TH, "text-center")}>
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.events.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={8} className="px-4 py-14 text-center">
                        <p className="font-medium">No events found</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {anyFilter
                            ? "Nothing matches these filters in the selected dates."
                            : "Nothing was recorded in the selected dates."}
                        </p>
                        {anyFilter && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-4"
                            onClick={clear}
                          >
                            Clear filters
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.events.map((event) => (
                      <EventRow
                        key={event.id}
                        event={event}
                        timeZone={timeZone}
                        now={now}
                        selected={event.id === selectedId}
                        onOpen={() => setSelectedId(event.id)}
                      />
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-3 sm:flex-row">
              <p className="text-sm text-muted-foreground">
                {data.total === 0
                  ? "No events"
                  : `Showing ${firstRow}–${lastRow} of ${data.total.toLocaleString("en-US")} ${data.total === 1 ? "event" : "events"}`}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                {pageCount > 1 && (
                  <Pagination
                    page={Math.min(filters.page, pageCount)}
                    pageCount={pageCount}
                    hrefFor={(page) => hrefFor({ page })}
                    label="Audit log pages"
                  />
                )}
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  Show
                  <Select
                    value={String(filters.pageSize)}
                    onValueChange={(value) => go({ pageSize: Number(value) })}
                  >
                    <SelectTrigger
                      className="h-9 w-20"
                      aria-label="Events per page"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUDIT_PAGE_SIZES.map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Details open over the page, so the table keeps its full width. */}
      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelectedId(null)}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        >
          <SheetTitle className="sr-only">Event details</SheetTitle>
          {shown && (
            <AuditEventDetails
              event={shown}
              timeZone={timeZone}
              now={now}
              onClose={() => setSelectedId(null)}
              onShowUserEvents={() => showUserEvents(shown)}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function FilterSelect({
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  allLabel: string;
  options: { value: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => onChange(next === ALL ? null : next)}
    >
      <SelectTrigger
        className="h-10! w-full rounded-lg bg-card xl:w-40 2xl:w-44"
        aria-label={label}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        side="bottom"
        align="start"
        position="popper"
        className="p-1"
      >
        <SelectItem value={ALL} className="p-2 cursor-pointer">
          {allLabel}
        </SelectItem>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="p-2 cursor-pointer"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors",
        active
          ? "border-brand-accent text-brand-accent"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-xs tabular-nums",
          active
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
            : "bg-muted text-muted-foreground",
        )}
      >
        {count.toLocaleString("en-US")}
      </span>
    </button>
  );
}

function EventRow({
  event,
  timeZone,
  now,
  selected,
  onOpen,
}: {
  event: AuditEvent;
  timeZone: string;
  now: number;
  selected: boolean;
  onOpen: () => void;
}) {
  const ActionIcon = AUDIT_ACTION_ICONS[event.action];

  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      className={cn(
        "cursor-pointer",
        selected &&
          "bg-emerald-50/70 hover:bg-emerald-50/70 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/30",
      )}
      onClick={onOpen}
    >
      <TableCell className="px-4 py-3">
        <p className="font-medium whitespace-nowrap">
          {formatAuditTimestamp(event.createdAt, timeZone)}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatRelativeTime(event.createdAt, now)}
        </p>
      </TableCell>

      <TableCell className="px-4 py-3">
        {event.actor ? (
          <div className="flex items-center gap-2.5">
            <Avatar className="size-8">
              {event.actor.avatarUrl && (
                <AvatarImage src={event.actor.avatarUrl} alt="" />
              )}
              <AvatarFallback className="text-xs font-semibold">
                {getInitials(event.actor.name, event.actor.email)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 max-w-44">
              <p className="truncate font-medium">{event.actor.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {event.actor.role ?? event.actor.email}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <User className="size-4" aria-hidden />
            </span>
            <p className="font-medium text-muted-foreground">System</p>
          </div>
        )}
      </TableCell>

      <TableCell className="px-4 py-3">
        <Badge className={cn("gap-1", AUDIT_ACTION_BADGE[event.action])}>
          <ActionIcon className="size-3" aria-hidden />
          {AUDIT_ACTION_LABELS[event.action]}
        </Badge>
      </TableCell>

      <TableCell className="px-4 py-3">
        <Badge className={AUDIT_MODULE_BADGE[event.module]}>
          {AUDIT_MODULE_LABELS[event.module]}
        </Badge>
      </TableCell>

      <TableCell className="max-w-80 px-4 py-3">
        <p className="truncate" title={event.summary}>
          {event.summary}
        </p>
      </TableCell>

      <TableCell className="px-4 py-3">
        <Badge className={AUDIT_RESULT_BADGE[event.result]}>
          {AUDIT_RESULT_LABELS[event.result]}
        </Badge>
      </TableCell>

      <TableCell className="px-4 py-3 font-mono text-[13px] whitespace-nowrap">
        {event.ip ?? <span className="font-sans text-muted-foreground">—</span>}
      </TableCell>

      <TableCell
        className="px-4 py-3 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          variant="outline"
          size="icon"
          className="size-8 rounded-lg text-muted-foreground shadow-none hover:text-foreground"
          aria-label="View event details"
          title="View details"
          onClick={onOpen}
        >
          <Eye className="size-4" aria-hidden />
        </Button>
      </TableCell>
    </TableRow>
  );
}
