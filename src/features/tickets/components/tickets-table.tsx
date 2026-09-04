"use client";

import { useTransition, useState, useEffect, ReactNode } from "react";
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
  ChevronDown,
  ChevronUp,
  Columns,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import CreateTicketSheet from "./create-ticket-sheet";
import { Ticket, TicketPriority, TicketStatus } from "../types/tickets.types";
import {
  bulkAssignToMeAction,
  bulkMarkSolvedAction,
  bulkSetPriorityAction,
} from "../actions/tickets.actions";
import Link from "next/link";
import { TicketsEmptyState } from "./ticket-empty";
import TicketImportWizard from "./csv-import";
import { useRealtimeTicketsRefresh } from "@/hooks/use-realtime-tickets-refresh";
import { computeLiveSla } from "../lib/sla";

interface TicketsTableProps {
  initialTickets: Ticket[];
  totalCount: number;
  statusCounts?: Partial<Record<TicketStatus, number>>;
  tenant: string;
}

type ColumnKey =
  "id" | "subject" | "requester" | "priority" | "assignee" | "status" | "sla";

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={`h-8 whitespace-nowrap border ${
        active
          ? "bg-accent text-accent-foreground font-semibold border-accent-foreground/20"
          : "border-transparent text-slate-500 hover:text-slate-800"
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
}: TicketsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  useRealtimeTicketsRefresh(tenant);
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState(
    searchParams.get("search") || "",
  );
  const [view, setView] = useState<"list" | "import">("list");
  const [bulkAction, setBulkAction] = useState<
    "assign" | "priority" | "solved" | null
  >(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
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
  ) => {
    if (selectedTicketIds.length === 0) return;
    setBulkAction(action);
    setBulkError(null);

    try {
      const res = await (action === "assign"
        ? bulkAssignToMeAction({
            tenantId: tenant,
            ticketIds: selectedTicketIds,
          })
        : action === "priority"
          ? bulkSetPriorityAction({
              tenantId: tenant,
              ticketIds: selectedTicketIds,
              priority: priority!,
            })
          : bulkMarkSolvedAction({
              tenantId: tenant,
              ticketIds: selectedTicketIds,
            }));

      if (res.success) {
        setSelectedTicketIds([]);
        router.refresh();
      } else {
        setBulkError(res.error || "Failed to update tickets.");
      }
    } finally {
      setBulkAction(null);
    }
  };

  const handleAssignToMe = () => {
    startTransition(() => runBulkAction("assign"));
  };

  const handleSetPriority = (priority: string) => {
    startTransition(() =>
      runBulkAction("priority", priority as TicketPriority),
    );
  };

  const handleMarkSolved = () => {
    startTransition(() => runBulkAction("solved"));
  };

  const getStatusBadge = (status: string) => {
    switch (status?.toLowerCase()) {
      case "new":
        return (
          <Badge className="rounded-full bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none font-semibold">
            New
          </Badge>
        );
      case "open":
        return (
          <Badge className="rounded-full bg-blue-100 text-blue-800 hover:bg-blue-100 border-none font-semibold">
            Open
          </Badge>
        );
      case "pending":
        return (
          <Badge className="rounded-full bg-amber-100 text-amber-800 hover:bg-amber-100 border-none font-semibold">
            Pending
          </Badge>
        );
      case "solved":
      case "resolved":
        return (
          <Badge className="rounded-full bg-slate-100 text-slate-700 hover:bg-slate-100 border-none font-semibold">
            Resolved
          </Badge>
        );
      case "on_hold":
        return (
          <Badge className="rounded-full bg-purple-100 text-purple-800 hover:bg-purple-100 border-none font-semibold">
            On hold
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="rounded-full">
            {status}
          </Badge>
        );
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case "urgent":
        return (
          <Badge className="rounded-full bg-red-50 text-red-700 border-red-200 font-semibold">
            Urgent
          </Badge>
        );
      case "high":
        return (
          <Badge className="rounded-full bg-orange-50 text-orange-700 border-orange-200 font-semibold">
            High
          </Badge>
        );
      case "normal":
        return (
          <Badge className="rounded-full bg-slate-50 text-slate-600 border-slate-200 font-semibold">
            Normal
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="rounded-full">
            {priority}
          </Badge>
        );
    }
  };

  const updateQueryParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    if (key !== "page") params.set("page", "1");

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const currentSort = searchParams.get("sort") || "";
  const currentSortOrder = searchParams.get("sortOrder") || "desc";

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

  const currentPage = Number(searchParams.get("page")) || 1;
  const currentLimit = Number(searchParams.get("limit")) || 8;
  const totalPages = Math.ceil(totalCount / currentLimit);

  const allOpenCount = Object.values(statusCounts).reduce(
    (sum, n) => sum + (n || 0),
    0,
  );

  const isAllSelected =
    initialTickets.length > 0 &&
    initialTickets.every((t) => selectedTicketIds.includes(t.id));

  if (view === "import") {
    return <TicketImportWizard onBack={() => setView("list")} />;
  }
  return (
    <div className="h-full bg-slate-50/50  font-sans text-slate-700">
      <div className="max-w mx-auto space-y-6">
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
                  className="text-xs font-semibold flex items-center gap-1.5 h-9"
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
              className="bg-teal-800 hover:bg-teal-900 text-white text-xs font-semibold h-9"
            >
              New ticket
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setView("import")}
              className="bg-white text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-50 h-9 border-slate-200"
            >
              Import from CSV
            </Button>
          </div>
        </div>

        <div className="flex items-center space-x-1 border-b border-slate-200 pb-3 text-xs font-medium overflow-x-auto scrollbar-none">
          <TabButton
            active={!searchParams?.get("status")}
            onClick={() => updateQueryParam("status", "all")}
          >
            All open
            <Badge
              className={`ml-1 rounded-full text-[10px] px-1.5 py-0 ${
                !searchParams?.get("status")
                  ? "bg-brand-badge text-brand-badge-foreground"
                  : "bg-teal-100 text-teal-800"
              }`}
            >
              {allOpenCount}
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
                  ? "bg-brand-badge text-brand-badge-foreground"
                  : "bg-teal-100 text-teal-800"
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
                  ? "bg-brand-badge text-brand-badge-foreground"
                  : "bg-teal-100 text-teal-800"
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
                  ? "bg-brand-badge text-brand-badge-foreground"
                  : "bg-teal-100 text-teal-800"
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
              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
              <Input
                type="text"
                value={searchQuery}
                placeholder="Search this view"
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  updateQueryParam("search", e.target.value);
                }}
                className="pl-8 h-10 text-xs bg-white border-slate-200 "
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
                <SelectTrigger className="w-full min-h-10 text-xs bg-white border-slate-200">
                  <SelectValue placeholder="All priorities" />
                </SelectTrigger>
                <SelectContent side="bottom" align="start" position="popper">
                  <SelectItem value="all">All priorities</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
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
                <SelectTrigger className="w-full min-h-10 text-xs bg-white border-slate-200">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent side="bottom" align="start" position="popper">
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="on_hold">On hold</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
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
              <Button
                variant="outline"
                size="sm"
                onClick={handleAssignToMe}
                disabled={bulkAction !== null || isPending}
                className="h-8 border-teal-600/40 bg-white text-teal-800 hover:bg-teal-50 text-xs font-semibold"
              >
                {bulkAction === "assign" && (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                )}
                Assign to me
              </Button>

              <Select
                value=""
                onValueChange={handleSetPriority}
                disabled={bulkAction !== null || isPending}
              >
                <SelectTrigger className="h-8 border-teal-600/40 bg-white text-teal-800 hover:bg-teal-50 text-xs font-semibold w-28">
                  <SelectValue placeholder="Set priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={handleMarkSolved}
                disabled={bulkAction !== null || isPending}
                className="h-8 border-teal-600/40 bg-white text-teal-800 hover:bg-teal-50 text-xs font-semibold"
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
                className="h-8 text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-teal-100/50"
              >
                Clear
              </Button>
            </div>
          </div>
        )}

        <Card className="shadow-sm border-slate-200/80 overflow-hidden p-0 ring-0">
          <CardContent className="p-0">
            {initialTickets.length === 0 ? (
              <TicketsEmptyState onAction={() => setIsSheetOpen(true)} />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200/80 bg-white">
                <Table>
                  <TableHeader className="bg-slate-50/50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200/80">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-12 px-4 text-center">
                        <Checkbox
                          checked={isAllSelected}
                          onCheckedChange={(checked) =>
                            handleSelectAll(Boolean(checked))
                          }
                          className="h-4 w-4 rounded-md border-slate-300 data-[state=checked]:bg-emerald-600 data-[state=checked]:text-white"
                        />
                      </TableHead>

                      {visibleColumns?.id && (
                        <TableHead className="w-20 px-4 font-bold text-slate-500">
                          TICKET
                        </TableHead>
                      )}

                      {visibleColumns?.subject && (
                        <TableHead className="px-4 font-bold text-teal-800">
                          <button
                            type="button"
                            onClick={handleSortToggle}
                            className="flex items-center space-x-1 cursor-pointer select-none text-teal-800 hover:text-teal-900 transition-colors font-bold uppercase"
                          >
                            <span>SUBJECT</span>
                            {currentSort === "subject" && (
                              <span className="text-xs">
                                {currentSortOrder === "asc" ? "↑" : "↓"}
                              </span>
                            )}
                          </button>
                        </TableHead>
                      )}

                      {visibleColumns?.requester && (
                        <TableHead className="w-48 px-4 font-bold text-slate-500">
                          REQUESTER
                        </TableHead>
                      )}

                      {visibleColumns?.priority && (
                        <TableHead className="w-32 px-4 text-center font-bold text-slate-500">
                          PRIORITY
                        </TableHead>
                      )}

                      {visibleColumns?.assignee && (
                        <TableHead className="w-40 px-4 font-bold text-slate-500">
                          ASSIGNEE
                        </TableHead>
                      )}

                      {visibleColumns?.status && (
                        <TableHead className="w-32 px-4 text-center font-bold text-slate-500">
                          STATUS
                        </TableHead>
                      )}

                      {visibleColumns?.sla && (
                        <TableHead className="w-32 px-4 text-right font-bold text-slate-500">
                          SLA
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>

                  <TableBody className="divide-y divide-slate-100 text-sm">
                    {initialTickets.map((ticket) => {
                      const isSelected = selectedTicketIds.includes(ticket.id);

                      return (
                        <TableRow
                          key={ticket.id}
                          className={`transition-colors cursor-pointer group hover:bg-slate-50/50 ${
                            isSelected ? "bg-teal-50/30" : ""
                          }`}
                        >
                          <TableCell className="px-4 text-center align-middle">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) =>
                                handleSelectRow(ticket.id, Boolean(checked))
                              }
                              className="h-4 w-4 rounded-md border-slate-300 data-[state=checked]:bg-emerald-600 data-[state=checked]:text-white"
                            />
                          </TableCell>

                          {visibleColumns?.id && (
                            <TableCell className="px-4 align-middle text-xs font-normal text-slate-400">
                              <Link
                                href={`/${tenant}/tickets/${ticket.id}`}
                                className="block py-1 hover:text-slate-600"
                              >
                                #{ticket.id.substring(0, 4)}
                              </Link>
                            </TableCell>
                          )}

                          {visibleColumns?.subject && (
                            <TableCell className="px-4 align-middle">
                              <Link
                                href={`/${tenant}/tickets/${ticket.id}`}
                                className="block py-1 font-semibold text-slate-900 group-hover:text-teal-900 transition-colors line-clamp-1"
                              >
                                {ticket.subject}
                              </Link>
                            </TableCell>
                          )}

                          {visibleColumns?.requester && (
                            <TableCell className="px-4 align-middle">
                              <Link
                                href={`/${tenant}/tickets/${ticket.id}`}
                                className="block py-1 text-xs"
                              >
                                <div className="font-semibold text-slate-700 leading-snug">
                                  {ticket.customers?.full_name || "Customer"}
                                </div>
                                {ticket.customers?.company && (
                                  <div className="text-slate-400 text-[11px] leading-snug">
                                    {ticket.customers.company}
                                  </div>
                                )}
                              </Link>
                            </TableCell>
                          )}

                          {visibleColumns?.priority && (
                            <TableCell className="px-4 align-middle text-center">
                              <Link
                                href={`/${tenant}/tickets/${ticket.id}`}
                                className="inline-block py-1"
                              >
                                {getPriorityBadge(ticket.priority)}
                              </Link>
                            </TableCell>
                          )}

                          {visibleColumns?.assignee && (
                            <TableCell className="px-4 align-middle text-xs text-slate-600">
                              <Link
                                href={`/${tenant}/tickets/${ticket.id}`}
                                className="block py-1"
                              >
                                {ticket.assignee_name ? (
                                  <span className="inline-flex items-center gap-2 font-medium">
                                    {ticket.assignee_initials && (
                                      <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px] font-bold">
                                        {ticket.assignee_initials}
                                      </span>
                                    )}
                                    {ticket.assignee_name}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-2 text-slate-500 font-medium">
                                    <span className="w-5 h-5 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] text-slate-400">
                                      —
                                    </span>
                                    Unassigned
                                  </span>
                                )}
                              </Link>
                            </TableCell>
                          )}

                          {visibleColumns?.status && (
                            <TableCell className="px-4 align-middle text-center">
                              <Link
                                href={`/${tenant}/tickets/${ticket.id}`}
                                className="inline-block py-1"
                              >
                                {getStatusBadge(ticket.status)}
                              </Link>
                            </TableCell>
                          )}

                          {visibleColumns?.sla && (() => {
                            const live = computeLiveSla(ticket, now);
                            return (
                              <TableCell className="w-35 px-4 text-right text-xs">
                                <Link
                                  href={`/${tenant}/tickets/${ticket.id}`}
                                  className="inline-flex w-full justify-end py-1"
                                >
                                  {live.text === "—" || !live.text ? (
                                    <span className="text-slate-400">—</span>
                                  ) : (
                                    <span
                                      className={cn(
                                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                                        live.type === "breached"
                                          ? "bg-rose-100/80 text-rose-800"
                                          : live.type === "warning"
                                            ? "bg-amber-100/80 text-amber-900"
                                            : live.type === "completed"
                                              ? "bg-emerald-100/80 text-emerald-800"
                                              : "bg-[#0e7adf]/10 text-[#0e7adf]",
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          "w-1.5 h-1.5 rounded-full shrink-0",
                                          live.type === "breached"
                                            ? "bg-rose-600"
                                            : live.type === "warning"
                                              ? "bg-amber-600"
                                              : live.type === "completed"
                                                ? "bg-emerald-600"
                                                : "bg-[#0e7adf]",
                                        )}
                                      />
                                      {live.text}
                                    </span>
                                  )}
                                </Link>
                              </TableCell>
                            );
                          })()}
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
                <SelectTrigger className="w-16 h-7 text-xs bg-white border-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="8">8</SelectItem>
                  <SelectItem value="15">15</SelectItem>
                  <SelectItem value="25">25</SelectItem>
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
                className="h-7 w-7"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 bg-teal-50 text-teal-800 font-bold border-teal-200"
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
                className="h-7 w-7"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
        <CreateTicketSheet
          open={isSheetOpen}
          onOpenChange={setIsSheetOpen}
          tenant={tenant}
        />
      </div>
    </div>
  );
}
