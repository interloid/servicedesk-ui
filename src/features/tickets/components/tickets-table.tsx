"use client";

import { useTransition, useState, useEffect, useRef, ReactNode } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Columns,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import CreateTicketSheet from "./create-ticket-sheet";
import {
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  Ticket,
  TicketPriority,
  TicketStatus,
  isPriorityLowered,
} from "../types/tickets.types";
import { PriorityReasonDialog } from "./priority-reason-dialog";
import { toast } from "sonner";
import {
  bulkAssignToMeAction,
  bulkMarkSolvedAction,
  bulkSetPriorityAction,
} from "../actions/tickets.actions";
import Link from "next/link";
import { TicketsEmptyState } from "./ticket-empty";
import { useRealtimeTicketsRefresh } from "@/hooks/use-realtime-tickets-refresh";
import { LiveSla, computeLiveSla } from "../lib/sla";
import { TICKET_PAGE_SIZES } from "../lib/list";
import { useNow } from "@/hooks/use-now";
import { useMounted } from "@/hooks/use-mounted";
import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";

interface TicketsTableProps {
  initialTickets: Ticket[];
  totalCount: number;
  statusCounts?: Partial<Record<TicketStatus, number>>;
  tenant: string;
  /** False for tenant admins: tickets go to agents and managers. */
  canAssignToSelf?: boolean;
  /** The page and page size the server loaded, already clamped. */
  page?: number;
  limit?: number;
}

type ColumnKey =
  "id" | "subject" | "requester" | "priority" | "assignee" | "status" | "sla";

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

const PRIORITY_STYLES: Record<string, { badge: string; dot: string }> = {
  urgent: { badge: "bg-red-100 text-red-800", dot: "bg-red-500" },
  high: { badge: "bg-orange-100 text-orange-800", dot: "bg-orange-500" },
  normal: { badge: "bg-blue-100 text-blue-800", dot: "bg-blue-500" },
  low: { badge: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-600" },
};

const STATUS_BADGE: Record<TicketStatus, string> = {
  new: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  open: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  pending: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  on_hold: "bg-purple-100 text-purple-800 hover:bg-purple-100",
  resolved: "bg-slate-100 text-slate-700 hover:bg-slate-100",
  closed: "bg-slate-200 text-slate-600 hover:bg-slate-200",
};

const SLA_PILL: Record<LiveSla["type"], { pill: string; dot: string }> = {
  breached: { pill: "bg-rose-100/80 text-rose-800", dot: "bg-rose-600" },
  warning: { pill: "bg-amber-100/80 text-amber-900", dot: "bg-amber-600" },
  paused: { pill: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  waiting: { pill: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  completed: {
    pill: "bg-emerald-100/80 text-emerald-800",
    dot: "bg-emerald-600",
  },
  normal: { pill: "bg-[#0e7adf]/10 text-[#0e7adf]", dot: "bg-[#0e7adf]" },
};

/**
 * The SLA badge, in its own component so the 30-second tick re-renders this
 * cell and not the whole table. The "Resumes …" opening is in the viewer's
 * time zone, so it is only shown once mounted.
 */
function SlaBadge({ ticket }: { ticket: Ticket }) {
  const now = useNow(30_000);
  const mounted = useMounted();
  const live = computeLiveSla(ticket, now);
  if (live.text === "—" || !live.text) {
    return <span className="text-slate-400">—</span>;
  }
  const style = SLA_PILL[live.type] ?? SLA_PILL.normal;
  return (
    <span
      // Read from the clock, which differs between server render and browser.
      suppressHydrationWarning
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        style.pill,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", style.dot)} />
      {live.type === "waiting" && !mounted
        ? "Outside business hours"
        : live.text}
    </span>
  );
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={`h-8 whitespace-nowrap border ${
        active
          ? "border-transparent bg-brand-accent font-semibold text-primary-foreground hover:bg-brand-hover hover:text-primary-foreground"
          : "border-transparent bg-white text-slate-500 hover:text-slate-800"
      }`}
    >
      {children}
    </Button>
  );
}

export default function TicketsTable({
  initialTickets,
  totalCount,
  statusCounts = {},
  tenant,
  canAssignToSelf = true,
  page,
  limit,
}: TicketsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  useRealtimeTicketsRefresh(tenant, initialTickets[0]?.tenant_id);
  const [pickedTicketIds, setSelectedTicketIds] = useState<string[]>([]);
  // Only rows still on screen count: a realtime refresh can drop a picked
  // ticket from this view without the URL changing.
  const visibleIds = new Set(initialTickets.map((t) => t.id));
  const selectedTicketIds = pickedTicketIds.filter((id) => visibleIds.has(id));
  // A selection only covers the rows on screen: moving to another page,
  // filter or search drops it, so a bulk action can't reach hidden tickets.
  const viewKey = searchParams.toString();
  const [selectionViewKey, setSelectionViewKey] = useState(viewKey);
  if (selectionViewKey !== viewKey) {
    setSelectionViewKey(viewKey);
    setSelectedTicketIds([]);
  }
  const urlSearch = searchParams.get("search") || "";
  const [searchQuery, setSearchQuery] = useState(urlSearch);
  // Follow ?search= when it changes from outside the box (back/forward), but
  // not when it's the box's own debounced write catching up.
  const [seenUrlSearch, setSeenUrlSearch] = useState(urlSearch);
  const [sentSearch, setSentSearch] = useState(urlSearch);
  if (seenUrlSearch !== urlSearch) {
    setSeenUrlSearch(urlSearch);
    if (urlSearch !== sentSearch) {
      setSearchQuery(urlSearch);
      setSentSearch(urlSearch);
    }
  }
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );
  const [bulkAction, setBulkAction] = useState<
    "assign" | "priority" | "solved" | null
  >(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  // A bulk priority that lowers at least one ticket, waiting for its reason.
  const [bulkLowerTo, setBulkLowerTo] = useState<TicketPriority | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<
    Record<ColumnKey, boolean>
  >({
    id: true,
    subject: true,
    requester: true,
    priority: true,
    assignee: true,
    status: true,
    sla: true,
  });

  const toggleColumn = (column: ColumnKey) => {
    setVisibleColumns((prev) => ({
      ...prev,
      [column]: !prev[column],
    }));
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedTicketIds(initialTickets.map((t) => t.id));
    } else {
      setSelectedTicketIds([]);
    }
  };

  const handleSelectRow = (ticketId: string, checked: boolean) => {
    if (checked) {
      setSelectedTicketIds((prev) => [...prev, ticketId]);
    } else {
      setSelectedTicketIds((prev) => prev.filter((id) => id !== ticketId));
    }
  };

  const runBulkAction = async (
    action: "assign" | "priority" | "solved",
    priority?: TicketPriority,
    reason?: string,
  ) => {
    if (selectedTicketIds.length === 0) return;
    setBulkAction(action);
    setBulkError(null);

    try {
      const res = await (action === "assign"
        ? bulkAssignToMeAction({
            tenantSlug: tenant,
            ticketIds: selectedTicketIds,
          })
        : action === "priority"
          ? bulkSetPriorityAction({
              tenantSlug: tenant,
              ticketIds: selectedTicketIds,
              priority: priority!,
              reason,
            })
          : bulkMarkSolvedAction({
              tenantSlug: tenant,
              ticketIds: selectedTicketIds,
            }));

      if (res.success) {
        setSelectedTicketIds([]);
        setBulkLowerTo(null);
        if ("slaKept" in res && res.slaKept) {
          toast.success(
            `${res.slaKept} ticket${res.slaKept === 1 ? " was" : "s were"} due soon, so ${res.slaKept === 1 ? "its" : "their"} SLA deadline stays as it was.`,
          );
        }
        if ("failed" in res && res.failed) {
          toast.warning(
            `${res.failed} ticket${res.failed === 1 ? "" : "s"} couldn't be updated. The rest were.`,
          );
        }
        // The bulk actions' revalidatePath refreshes the list.
      } else {
        setBulkError(res.error || "Failed to update tickets.");
        // The reason dialog covers the inline error; say it there too.
        if (reason) toast.error(res.error || "Failed to update tickets.");
      }
    } catch {
      // Thrown inside a transition this would reach error.tsx and replace
      // the whole list; keep it inline like any other failure.
      setBulkError("Couldn't reach the server. Try again.");
      if (reason) toast.error("Couldn't reach the server. Try again.");
    } finally {
      setBulkAction(null);
    }
  };

  const handleAssignToMe = () => {
    startTransition(() => runBulkAction("assign"));
  };

  // Lowering any selected ticket asks why first; the reason goes on each
  // lowered ticket's audit entry.
  const handleSetPriority = (value: string) => {
    const priority = value as TicketPriority;
    const lowersAny = initialTickets.some(
      (t) =>
        selectedTicketIds.includes(t.id) &&
        isPriorityLowered(t.priority, priority),
    );
    if (lowersAny) {
      setBulkLowerTo(priority);
      return;
    }
    startTransition(() => runBulkAction("priority", priority));
  };

  const handleMarkSolved = () => {
    startTransition(() => runBulkAction("solved"));
  };

  const getStatusBadge = (status: string) => {
    const key = status?.toLowerCase() as TicketStatus;
    if (!(key in STATUS_BADGE)) {
      return (
        <Badge variant="outline" className="h-6 rounded-full px-2.5 text-xs">
          {status}
        </Badge>
      );
    }
    return (
      <Badge
        className={cn(
          "h-6 rounded-full px-2.5 text-xs border-none font-semibold",
          STATUS_BADGE[key],
        )}
      >
        {TICKET_STATUS_LABELS[key]}
      </Badge>
    );
  };

  // The status badge's pill, with the SLA editor's priority dot inside.
  const getPriorityBadge = (priority: string) => {
    const style = PRIORITY_STYLES[priority?.toLowerCase()];
    return (
      <Badge
        className={cn(
          "h-6 gap-1.5 rounded-full border-none px-2.5 text-xs font-semibold",
          style?.badge ?? "bg-slate-100 text-slate-700",
        )}
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            style?.dot ?? "bg-slate-400",
          )}
        />
        {TICKET_PRIORITY_LABELS[priority?.toLowerCase() as TicketPriority] ??
          priority}
      </Badge>
    );
  };

  const updateQueryParam = (key: string, value: string, replace = false) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    if (key !== "page") params.set("page", "1");

    startTransition(() => {
      const url = `${pathname}?${params.toString()}`;
      if (replace) router.replace(url);
      else router.push(url);
    });
  };

  // Same defaults as the page: subject A→Z.
  const currentSort = searchParams.get("sort") || "subject";
  const currentSortOrder =
    searchParams.get("sortOrder") ||
    (currentSort === "subject" ? "asc" : "desc");

  const handleSortToggle = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (currentSort === "subject") {
      params.set("sortOrder", currentSortOrder === "asc" ? "desc" : "asc");
    } else {
      params.set("sort", "subject");
      params.set("sortOrder", "asc");
    }
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  // As the page clamps them, so the pager names the page actually loaded.
  const currentPage =
    page ?? Math.max(1, Math.floor(Number(searchParams.get("page"))) || 1);
  const currentLimit =
    limit ??
    (TICKET_PAGE_SIZES.includes(Number(searchParams.get("limit")))
      ? Number(searchParams.get("limit"))
      : TICKET_PAGE_SIZES[0]);
  const totalPages = Math.ceil(totalCount / currentLimit);

  // A page past the end (after a bulk resolve or a realtime removal on page
  // 2+) would read as "Queue clear" with no pager: go to the last real page.
  const pastEnd = initialTickets.length === 0 && currentPage > 1;
  const lastPage = Math.max(1, totalPages);
  useEffect(() => {
    if (!pastEnd) return;
    const params = new URLSearchParams(window.location.search);
    params.set("page", String(lastPage));
    router.replace(`${pathname}?${params.toString()}`);
  }, [pastEnd, lastPage, pathname, router]);

  const allCount = Object.values(statusCounts).reduce(
    (sum, n) => sum + (n || 0),
    0,
  );

  // The column that carries the row's link: the subject, else the first
  // column still shown.
  const linkColumn = (
    [
      "subject",
      "id",
      "requester",
      "priority",
      "assignee",
      "status",
      "sla",
    ] as ColumnKey[]
  ).find((c) => visibleColumns[c]);

  const isAllSelected =
    initialTickets.length > 0 &&
    initialTickets.every((t) => selectedTicketIds.includes(t.id));

  return (
    <div className="h-full overflow-y-auto p-4 font-sans sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Tickets
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              {totalCount} total tickets ·{" "}
              <span className="text-slate-700 font-medium">
                Tenant: {tenant}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 gap-1.5 px-3 text-sm font-semibold"
                >
                  <Columns className="w-3.5 h-3.5" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 text-xs p-2">
                <DropdownMenuLabel className="text-[11px] font-bold text-slate-500 px-2 py-1.5">
                  Toggle Columns
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={visibleColumns?.id}
                  onCheckedChange={() => toggleColumn("id")}
                  className="py-2 px-2.5"
                >
                  Ticket
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns?.subject}
                  onCheckedChange={() => toggleColumn("subject")}
                  className="py-2 px-2.5"
                >
                  Subject
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns?.requester}
                  onCheckedChange={() => toggleColumn("requester")}
                  className="py-2 px-2.5"
                >
                  Requester
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns?.priority}
                  onCheckedChange={() => toggleColumn("priority")}
                  className="py-2 px-2.5"
                >
                  Priority
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns?.assignee}
                  onCheckedChange={() => toggleColumn("assignee")}
                  className="py-2 px-2.5"
                >
                  Assignee
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns?.status}
                  onCheckedChange={() => toggleColumn("status")}
                  className="py-2 px-2.5"
                >
                  Status
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleColumns?.sla}
                  onCheckedChange={() => toggleColumn("sla")}
                  className="py-2 px-2.5"
                >
                  SLA
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              size="sm"
              onClick={() => setIsSheetOpen(true)}
              className="h-10 bg-brand-accent px-4 text-sm font-semibold text-white hover:bg-brand-accent/90"
            >
              New ticket
            </Button>
          </div>
        </div>

        <div className="flex items-center space-x-1 border-b border-slate-200 pb-3 text-xs font-medium overflow-x-auto scrollbar-none">
          <TabButton
            active={!searchParams?.get("status")}
            onClick={() => updateQueryParam("status", "all")}
          >
            {/* Every status: the tab clears the status filter. */}
            All
            <Badge
              className={`ml-1 rounded-full text-[10px] px-1.5 py-0 ${
                !searchParams?.get("status")
                  ? "bg-primary-foreground/20 text-primary-foreground border-0"
                  : "bg-brand-accent text-brand-accent-foreground border-0"
              }`}
            >
              {allCount}
            </Badge>
          </TabButton>
          <TabButton
            active={searchParams?.get("status") === "new"}
            onClick={() => updateQueryParam("status", "new")}
          >
            New
            <Badge
              className={`ml-1 rounded-full text-[10px] px-1.5 py-0 ${
                searchParams?.get("status") === "new"
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-brand-accent text-brand-accent-foreground border-0"
              }`}
            >
              {statusCounts.new ?? 0}
            </Badge>
          </TabButton>
          <TabButton
            active={searchParams?.get("status") === "open"}
            onClick={() => updateQueryParam("status", "open")}
          >
            Open
            <Badge
              className={`ml-1 rounded-full text-[10px] px-1.5 py-0 ${
                searchParams?.get("status") === "open"
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-brand-accent text-brand-accent-foreground border-0"
              }`}
            >
              {statusCounts.open ?? 0}
            </Badge>
          </TabButton>
          <TabButton
            active={searchParams?.get("status") === "resolved"}
            onClick={() => updateQueryParam("status", "resolved")}
          >
            Resolved
            <Badge
              className={`ml-1 rounded-full text-[10px] px-1.5 py-0 ${
                searchParams?.get("status") === "resolved"
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-brand-accent text-brand-accent-foreground border-0"
              }`}
            >
              {statusCounts.resolved ?? 0}
            </Badge>
          </TabButton>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3 sm:gap-4">
          <div className="w-full sm:w-64 md:w-80 space-y-1">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="text"
                value={searchQuery}
                placeholder="Search this view"
                onChange={(e) => {
                  // One navigation once typing stops, replacing the entry,
                  // instead of a server render and a history step per key.
                  const value = e.target.value;
                  setSearchQuery(value);
                  if (searchTimer.current) clearTimeout(searchTimer.current);
                  // Built from the live URL when it fires: a filter picked in
                  // the meantime must not be overwritten by this render's copy.
                  searchTimer.current = setTimeout(() => {
                    const params = new URLSearchParams(window.location.search);
                    if (value) params.set("search", value);
                    else params.delete("search");
                    params.set("page", "1");
                    setSentSearch(value);
                    startTransition(() => {
                      router.replace(`${pathname}?${params.toString()}`);
                    });
                  }, 300);
                }}
                className="pl-8 h-10 bg-white border-slate-200"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:flex sm:space-x-4">
            <div className="space-y-1 w-full sm:w-36">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Priority
              </label>
              <Select
                value={searchParams?.get("priority") || "all"}
                onValueChange={(val) => updateQueryParam("priority", val)}
              >
                <SelectTrigger className="h-10 min-h-10 w-full bg-white border-slate-200">
                  <SelectValue placeholder="All priorities" />
                </SelectTrigger>
                <SelectContent
                  side="bottom"
                  align="start"
                  position="popper"
                  className="p-1"
                >
                  <SelectItem value="all" className="cursor-pointer p-2">
                    All priorities
                  </SelectItem>
                  {TICKET_PRIORITIES.map((p) => (
                    <SelectItem
                      key={p}
                      value={p}
                      className="cursor-pointer p-2"
                    >
                      {TICKET_PRIORITY_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 w-full sm:w-36">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Status
              </label>
              <Select
                value={searchParams?.get("status") || "all"}
                onValueChange={(val) => updateQueryParam("status", val)}
              >
                <SelectTrigger className="h-10 min-h-10 w-full bg-white border-slate-200">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent
                  side="bottom"
                  align="start"
                  position="popper"
                  className="p-1"
                >
                  <SelectItem value="all" className="cursor-pointer p-2">
                    All statuses
                  </SelectItem>
                  {TICKET_STATUSES.map((st) => (
                    <SelectItem
                      key={st}
                      value={st}
                      className="cursor-pointer p-2"
                    >
                      {TICKET_STATUS_LABELS[st]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {selectedTicketIds.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 justify-between rounded-lg border border-teal-600/30 bg-teal-50/60 px-4 py-2.5 text-xs font-semibold text-teal-900 transition-all">
            <span>{selectedTicketIds.length} selected</span>
            <div className="flex flex-wrap items-center gap-2">
              {bulkError && (
                <span className="text-red-600 font-medium mr-1">
                  {bulkError}
                </span>
              )}
              {canAssignToSelf && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAssignToMe}
                  disabled={bulkAction !== null || isPending}
                  className="h-9 px-3 border-teal-600/40 bg-white text-teal-800 hover:bg-teal-50 text-xs font-semibold"
                >
                  {bulkAction === "assign" && (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  )}
                  Assign to me
                </Button>
              )}

              <Select
                value=""
                onValueChange={handleSetPriority}
                disabled={bulkAction !== null || isPending}
              >
                <SelectTrigger className="h-9 min-h-9 w-32 border-teal-600/40 bg-white text-xs font-semibold text-teal-800">
                  <SelectValue placeholder="Set priority" />
                </SelectTrigger>
                <SelectContent
                  side="bottom"
                  align="start"
                  position="popper"
                  className="p-1"
                >
                  {TICKET_PRIORITIES.map((p) => (
                    <SelectItem
                      key={p}
                      value={p}
                      className="cursor-pointer p-2"
                    >
                      {TICKET_PRIORITY_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={handleMarkSolved}
                disabled={bulkAction !== null || isPending}
                className="h-9 px-3 border-teal-600/40 bg-white text-teal-800 hover:bg-teal-50 text-xs font-semibold"
              >
                {bulkAction === "solved" && (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                )}
                Mark resolved
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedTicketIds([])}
                disabled={bulkAction !== null || isPending}
                className="h-9 px-3 text-xs font-medium bg-brand-accent text-white hover:text-white hover:bg-brand-accent/90"
              >
                Clear
              </Button>
            </div>
          </div>
        )}

        <Card className=" border-slate-200/80 overflow-hidden p-0 ring-0">
          <CardContent className="p-0">
            {initialTickets.length === 0 ? (
              <TicketsEmptyState onAction={() => setIsSheetOpen(true)} />
            ) : (
              <div className="overflow-x-auto rounded-[14px] border border-border bg-card">
                <Table>
                  <TableHeader className="bg-slate-50/50 text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground border-b border-slate-200/80">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-12 px-4 text-center align-middle">
                        <Checkbox
                          checked={isAllSelected}
                          onCheckedChange={(checked) =>
                            handleSelectAll(Boolean(checked))
                          }
                          aria-label="Select all tickets on this page"
                          className="h-4 w-4 rounded-xl border-slate-300 data-[state=checked]:bg-brand-accent data-[state=checked]:text-white"
                        />
                      </TableHead>

                      {visibleColumns?.id && (
                        <TableHead className="w-24 px-4 text-left font-bold text-slate-500">
                          TICKET
                        </TableHead>
                      )}

                      {visibleColumns?.subject && (
                        <TableHead className="px-4 text-left font-bold text-slate-500">
                          <button
                            type="button"
                            onClick={handleSortToggle}
                            className="inline-flex items-center gap-1 cursor-pointer select-none text-slate-500 hover:text-slate-800 transition-colors font-bold uppercase"
                          >
                            <span>SUBJECT</span>
                            {currentSort === "subject" && (
                              <span aria-hidden>
                                {currentSortOrder === "asc" ? "↑" : "↓"}
                              </span>
                            )}
                          </button>
                        </TableHead>
                      )}

                      {visibleColumns?.requester && (
                        <TableHead className="w-48 px-4 text-left font-bold text-slate-500">
                          REQUESTER
                        </TableHead>
                      )}

                      {visibleColumns?.priority && (
                        <TableHead className="w-28 px-4 text-left font-bold text-slate-500">
                          PRIORITY
                        </TableHead>
                      )}

                      {visibleColumns?.assignee && (
                        <TableHead className="w-44 px-4 text-left font-bold text-slate-500">
                          ASSIGNEE
                        </TableHead>
                      )}

                      {visibleColumns?.status && (
                        <TableHead className="w-28 px-4 text-left font-bold text-slate-500">
                          STATUS
                        </TableHead>
                      )}

                      {visibleColumns?.sla && (
                        <TableHead className="w-36 px-4 text-right font-bold text-slate-500">
                          SLA
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>

                  <TableBody className="divide-y divide-slate-100 text-sm">
                    {initialTickets.map((ticket) => {
                      const isSelected = selectedTicketIds.includes(ticket.id);
                      const ticketHref = tenantPath(
                        tenant,
                        `${TENANT_ROUTES.TICKETS}/${ticket.id}`,
                      );
                      // One link per row, in the first visible column, so a
                      // screen reader meets each ticket once; the rest of the
                      // row opens it on click as before.
                      const cell = (
                        col: ColumnKey,
                        className: string,
                        children: ReactNode,
                      ) =>
                        col === linkColumn ? (
                          <Link href={ticketHref} className={className}>
                            {children}
                          </Link>
                        ) : (
                          <div className={className}>{children}</div>
                        );

                      return (
                        <TableRow
                          key={ticket.id}
                          onClick={(e) => {
                            const target = e.target as HTMLElement;
                            // The link and the checkbox handle their own
                            // clicks.
                            if (target.closest("a, button, [data-row-select]"))
                              return;
                            // Selecting text in a row shouldn't open it.
                            if (window.getSelection()?.toString()) return;
                            if (e.metaKey || e.ctrlKey) {
                              window.open(ticketHref, "_blank", "noopener");
                            } else {
                              router.push(ticketHref);
                            }
                          }}
                          className={`transition-colors cursor-pointer group hover:bg-slate-50/50 ${
                            isSelected ? "bg-teal-50/30" : ""
                          }`}
                        >
                          <TableCell
                            data-row-select
                            className="px-4 text-center align-middle"
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) =>
                                handleSelectRow(ticket.id, Boolean(checked))
                              }
                              aria-label={`Select ticket #${ticket.number ?? ticket.id}`}
                              className="h-4 w-4 rounded-md border-slate-300 data-[state=checked]:bg-brand-accent data-[state=checked]:text-white"
                            />
                          </TableCell>

                          {visibleColumns?.id && (
                            <TableCell className="px-4 align-middle text-sm font-medium text-muted-foreground tabular-nums">
                              {cell(
                                "id",
                                "block py-1 hover:text-slate-600",
                                <>#{ticket.number ?? "-"}</>,
                              )}
                            </TableCell>
                          )}

                          {visibleColumns?.subject && (
                            <TableCell className="px-4 align-middle">
                              {cell(
                                "subject",
                                "block py-1",
                                <>
                                  <span className="block truncate font-semibold text-slate-900">
                                    {ticket.subject
                                      ? ticket.subject.charAt(0).toUpperCase() +
                                        ticket.subject.slice(1)
                                      : ""}
                                  </span>
                                  {ticket.tags && ticket.tags.length > 0 && (
                                    <span className="mt-1 flex flex-wrap gap-1">
                                      {ticket.tags.slice(0, 3).map((tag) => (
                                        <span
                                          key={tag.id}
                                          className="rounded-full bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-600"
                                        >
                                          {tag.name}
                                        </span>
                                      ))}
                                      {ticket.tags.length > 3 && (
                                        <span className="text-[11px] font-medium text-slate-400">
                                          +{ticket.tags.length - 3}
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </>,
                              )}
                            </TableCell>
                          )}

                          {visibleColumns?.requester && (
                            <TableCell className="px-4 align-middle">
                              {cell(
                                "requester",
                                "block py-1",
                                <>
                                  <div className="text-sm font-semibold text-foreground leading-snug">
                                    {ticket.customers?.full_name || "Customer"}
                                  </div>
                                  {ticket.customers?.company && (
                                    <div className="text-xs text-muted-foreground leading-snug">
                                      {ticket.customers.company}
                                    </div>
                                  )}
                                </>,
                              )}
                            </TableCell>
                          )}

                          {visibleColumns?.priority && (
                            <TableCell className="px-4 align-middle text-left">
                              {cell(
                                "priority",
                                "inline-flex py-1",
                                getPriorityBadge(ticket.priority),
                              )}
                            </TableCell>
                          )}

                          {visibleColumns?.assignee && (
                            <TableCell className="px-4 align-middle text-sm text-foreground">
                              {cell(
                                "assignee",
                                "block py-1",
                                ticket.assignee_name ? (
                                  <span className="inline-flex items-center gap-2 font-medium whitespace-nowrap">
                                    {ticket.assignee_initials && (
                                      <span className="w-5 h-5 shrink-0 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px] font-bold">
                                        {ticket.assignee_initials}
                                      </span>
                                    )}
                                    {ticket.assignee_name}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-2 text-slate-500 font-medium whitespace-nowrap">
                                    <span className="w-5 h-5 shrink-0 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] text-slate-400">
                                      —
                                    </span>
                                    Unassigned
                                  </span>
                                ),
                              )}
                            </TableCell>
                          )}

                          {visibleColumns?.status && (
                            <TableCell className="px-4 align-middle text-left">
                              {cell(
                                "status",
                                "inline-flex py-1",
                                getStatusBadge(ticket.status),
                              )}
                            </TableCell>
                          )}

                          {visibleColumns?.sla && (
                            <TableCell className="px-4 align-middle text-right text-xs">
                              {cell(
                                "sla",
                                "inline-flex w-full justify-end py-1",
                                <SlaBadge ticket={ticket} />,
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        {initialTickets.length > 0 && (
          <div className="px-4 sm:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <div className="flex items-center space-x-2">
              <span>
                Showing {initialTickets.length} of {totalCount}
              </span>
              <span className="hidden sm:inline-block ml-4">Rows per page</span>
              <Select
                value={String(currentLimit)}
                onValueChange={(val) => updateQueryParam("limit", val)}
              >
                <SelectTrigger className="h-8 min-h-8 w-18 bg-white border-slate-200 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  side="bottom"
                  align="start"
                  position="popper"
                  className="p-1"
                >
                  {TICKET_PAGE_SIZES.map((size) => (
                    <SelectItem
                      key={size}
                      value={String(size)}
                      className="cursor-pointer p-2"
                    >
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-1">
              <Button
                variant="outline"
                size="icon"
                disabled={currentPage <= 1}
                onClick={() =>
                  updateQueryParam("page", String(currentPage - 1))
                }
                aria-label="Previous page"
                className="size-8"
              >
                <ChevronLeft className="w-3.5 h-3.5" aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Page ${currentPage}`}
                aria-current="page"
                className="h-8 min-w-8 px-2.5 bg-teal-50 text-teal-800 font-bold border-teal-200"
              >
                {currentPage}
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={currentPage >= totalPages || totalPages === 0}
                onClick={() =>
                  updateQueryParam("page", String(currentPage + 1))
                }
                aria-label="Next page"
                className="size-8"
              >
                <ChevronRight className="w-3.5 h-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        )}
        <CreateTicketSheet
          open={isSheetOpen}
          onOpenChange={setIsSheetOpen}
          tenant={tenant}
        />

        <PriorityReasonDialog
          open={bulkLowerTo !== null}
          to={bulkLowerTo}
          ticketCount={selectedTicketIds.length}
          pending={bulkAction === "priority"}
          onCancel={() => setBulkLowerTo(null)}
          onConfirm={(reason) =>
            bulkLowerTo &&
            startTransition(() =>
              runBulkAction("priority", bulkLowerTo, reason),
            )
          }
        />
      </div>
    </div>
  );
}
