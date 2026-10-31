"use client";

import React from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  UsersRound,
  Search,
  Star,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { AgentLoadMetric } from "../types/types";

type SortKey = "name" | "open" | "solved" | "reply" | "sla" | "csat";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Agent" },
  { key: "open", label: "Open" },
  { key: "solved", label: "Solved" },
  { key: "reply", label: "Median 1st reply" },
  { key: "sla", label: "SLA attainment" },
  { key: "csat", label: "CSAT" },
];

/** Rows shown before the table scrolls; the rest are a scroll away. */
const VISIBLE_ROWS = 10;
const ROW_HEIGHT = 60;
const HEADER_HEIGHT = 40;

const CELL = "px-4 sm:px-6";

const AVATAR_COLORS = [
  "bg-emerald-600",
  "bg-blue-600",
  "bg-violet-600",
  "bg-orange-500",
  "bg-rose-600",
  "bg-teal-600",
];

/** Stable per agent, so a re-sort or a new range never repaints someone. */
function avatarColor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function sortValue(
  agent: AgentLoadMetric,
  key: SortKey,
): string | number | null {
  switch (key) {
    case "name":
      return agent.name.toLowerCase();
    case "open":
      return agent.open;
    case "solved":
      return agent.solved;
    case "reply":
      return agent.medianFirstReplyMinutes;
    case "sla":
      return agent.slaMet;
    case "csat":
      return agent.csatAverage;
  }
}

function slaBarColor(pct: number): string {
  if (pct >= 90) return "bg-success";
  if (pct >= 70) return "bg-warning";
  return "bg-destructive";
}

export function AgentPerformanceTable({
  agents,
  className,
}: {
  agents: AgentLoadMetric[];
  className?: string;
}) {
  const [term, setTerm] = React.useState("");
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>(
    { key: "open", dir: "desc" },
  );

  const rows = React.useMemo(() => {
    const needle = term.trim().toLowerCase();
    const filtered = needle
      ? agents.filter(
          (a) =>
            a.name.toLowerCase().includes(needle) ||
            a.email.toLowerCase().includes(needle),
        )
      : agents;

    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      // Agents with no figure sink to the bottom whichever way it sorts.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const order = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === "asc" ? order : -order;
    });
  }, [agents, term, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );

  return (
    <Card
      data-pdf-expand
      className={cn(
        "min-w-0 gap-0 overflow-hidden rounded-xl bg-card p-0 shadow-sm ring-1",
        className,
      )}
    >
      {/* Same header as Billing history: icon tile, title, a count. */}
      <header className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
          >
            <UsersRound className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Agent Performance
            </h2>
            <p className="text-xs text-muted-foreground">
              {agents.length} agent{agents.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        {/* Left out of the PDF export: a search box means nothing on paper. */}
        <div data-pdf-hide className="relative w-full sm:w-64">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search agents..."
            aria-label="Search agents"
            maxLength={200}
            className="h-10 bg-card pl-9 text-sm"
          />
        </div>
      </header>

      {/* One scroll box for both axes: up to ten rows show (beside the charts
          on xl, the card keeps the column's height), the rest scroll inside
          the card under a pinned header, and narrow screens scroll sideways
          instead of crushing the columns. A plain <table> rather than <Table>, whose own
          overflow wrapper would become the sticky header's scroll parent. */}
      <div
        data-pdf-expand
        className="max-h-(--rows-max-h) min-h-0 flex-1 overflow-auto xl:max-h-none"
        style={
          {
            "--rows-max-h": `${HEADER_HEIGHT + (ROW_HEIGHT + 1) * VISIBLE_ROWS}px`,
          } as React.CSSProperties
        }
      >
        <table className="w-full min-w-170 caption-bottom text-sm">
          <TableHeader className="sticky top-0 z-10 [&_tr]:border-b">
            <TableRow
              className="border-slate-100 bg-slate-50 hover:bg-slate-50 dark:border-border dark:bg-muted dark:hover:bg-muted"
              style={{ height: HEADER_HEIGHT }}
            >
              {COLUMNS.map((column) => {
                const activeSort = sort.key === column.key;
                const SortIcon = !activeSort
                  ? ChevronsUpDown
                  : sort.dir === "asc"
                    ? ArrowUp
                    : ArrowDown;
                return (
                  <TableHead
                    key={column.key}
                    aria-sort={
                      activeSort
                        ? sort.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className="h-auto px-4 sm:px-6"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={cn(
                        "group/sort inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition-colors hover:text-slate-700 dark:hover:text-foreground",
                        activeSort
                          ? "text-slate-700 dark:text-foreground"
                          : "text-slate-500 dark:text-muted-foreground",
                      )}
                    >
                      {column.label}
                      {/* Only the sorted column shows its arrow; the rest
                          reveal theirs on hover, so the header stays as clean
                          as Billing history's. */}
                      <SortIcon
                        aria-hidden
                        className={cn(
                          "size-3 transition-opacity",
                          !activeSort &&
                            "opacity-0 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100",
                        )}
                      />
                    </button>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={COLUMNS.length}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {agents.length === 0
                    ? "No agent activity in this period"
                    : "No agents match your search"}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((agent) => (
                <TableRow
                  key={agent.id}
                  className="border-b border-slate-200 hover:bg-slate-50/60 dark:border-border dark:hover:bg-muted/30"
                  style={{ height: ROW_HEIGHT }}
                >
                  <TableCell className={cn(CELL, "py-0")}>
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white",
                          avatarColor(agent.id),
                        )}
                      >
                        {agent.initials || "?"}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {agent.name}
                          {agent.inactive && (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                              (inactive)
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {agent.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={cn(CELL, "tabular-nums")}>
                    {agent.open}
                  </TableCell>
                  <TableCell className={cn(CELL, "tabular-nums")}>
                    {agent.solved}
                  </TableCell>
                  <TableCell className={cn(CELL, "tabular-nums")}>
                    {agent.medianFirstReply ?? (
                      <span className="text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                  <TableCell className={cn(CELL, "min-w-44")}>
                    {agent.slaMet === null ? (
                      <span className="text-muted-foreground">N/A</span>
                    ) : (
                      <div className="space-y-1.5">
                        <p className="text-sm tabular-nums">
                          <span className="font-semibold text-foreground">
                            {agent.slaMet}%
                          </span>{" "}
                          <span className="text-muted-foreground">
                            ({agent.slaMetCount} / {agent.slaEligible})
                          </span>
                        </p>
                        <div className="h-1.5 w-full max-w-48 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              slaBarColor(agent.slaMet),
                            )}
                            style={{ width: `${agent.slaMet}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className={CELL}>
                    {agent.csatAverage === null ? (
                      <span className="text-muted-foreground font-bold">
                        N/A
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 tabular-nums">
                        <Star
                          aria-hidden
                          className="size-4 fill-amber-400 text-amber-400"
                        />
                        <span className="font-medium text-foreground">
                          {agent.csatAverage}
                        </span>
                        <span className="text-muted-foreground">
                          ({agent.csatResponses})
                        </span>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </table>
      </div>
    </Card>
  );
}
