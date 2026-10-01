"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Search,
  UsersRound,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  csatScoreTitle,
  csatTone,
  customerInitials,
  formatCsatScore,
  formatCustomerDate,
  formatCustomerRelative,
  type CustomerListItem,
} from "@/features/customers/types/customers";

import { pageWindow } from "@/lib/pagination";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

type SortKey =
  | "fullName"
  | "company"
  | "ticketCount"
  | "lastActivityAt"
  | "createdAt"
  | "csatScore";

type Sort = {
  key: SortKey;
  direction: "asc" | "desc";
};

export function customerPath(tenantSlug: string, customerId: string): string {
  return `/${tenantSlug}/customers/${customerId}`;
}

function compare(a: CustomerListItem, b: CustomerListItem, sort: Sort): number {
  const left = a[sort.key];
  const right = b[sort.key];

  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  const order =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right), undefined, {
          sensitivity: "base",
        });

  return sort.direction === "asc" ? order : -order;
}

export default function CustomersTable({
  tenant,
  initialCustomers,
  now,
}: {
  tenant: string;
  tenantName: string | null;
  initialCustomers: CustomerListItem[];
  now: number;
}) {
  const router = useRouter();

  const [query, setQuery] = React.useState("");

  const [sort, setSort] = React.useState<Sort>({
    key: "fullName",
    direction: "asc",
  });

  const [page, setPage] = React.useState(1);

  /*
   * Filter and sort customers
   */
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();

    return initialCustomers
      .filter(
        (customer) =>
          !q ||
          customer.fullName.toLowerCase().includes(q) ||
          customer.email.toLowerCase().includes(q) ||
          (customer.company ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => compare(a, b, sort));
  }, [initialCustomers, query, sort]);

  const hasActiveFilters = query.trim() !== "";

  /*
   * Pagination
   */
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const safePage = Math.min(page, totalPages);

  const start = (safePage - 1) * PAGE_SIZE;

  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  const count = initialCustomers.length;

  /*
   * Sorting
   */
  function toggleSort(key: SortKey) {
    setSort((current) => {
      if (current.key === key) {
        return {
          key,
          direction: current.direction === "asc" ? "desc" : "asc",
        };
      }

      return {
        key,
        direction:
          key === "ticketCount" ||
          key === "lastActivityAt" ||
          key === "createdAt" ||
          key === "csatScore"
            ? "desc"
            : "asc",
      };
    });

    setPage(1);
  }

  /*
   * Avatar
   */
  function avatar(customer: CustomerListItem) {
    return (
      <Avatar className="size-9 shrink-0">
        {customer.avatarUrl ? (
          <AvatarImage
            src={customer.avatarUrl}
            alt=""
            className="object-cover"
          />
        ) : null}

        <AvatarFallback className="bg-brand-accent/10 text-xs font-semibold text-brand-accent">
          {customerInitials(customer.fullName, customer.email)}
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 font-sans sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Customers
            </h1>

            <p className="text-sm text-muted-foreground">
              Companies and the people who raise tickets from them.
            </p>
          </div>

          {/*
           * The search sits in the heading row rather than in one of its own.
           * A full-width row above the table was a line of nothing between the
           * heading and the data -- 64px of it -- and a flex-1 field stretching
           * the page's width read as a toolbar above the table rather than as a
           * control for it. Top-aligned with the title, in the right corner,
           * and widening with the page instead of the other way round: the
           * field never takes a bite out of the columns underneath it.
           */}
          {/* Only the field now. The Clear filters button is gone: the search
              box is type="search", so the browser draws its own cross inside
              the field, and a second control that clears the same thing sat
              next to it saying the same thing in more words. */}
          <div className="relative w-full sm:w-80 lg:w-96">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />

            <Input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Search customers or company..."
              aria-label="Search customers"
              className="h-10 bg-card pl-9 text-sm"
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border bg-card">
          {count === 0 ? (
            <EmptyState />
          ) : (
            <>
              <div className="w-full overflow-x-auto">
                <Table className="w-full min-w-250 table-fixed">
                  <colgroup>
                    <col className="w-[26%]" />
                    <col className="w-[14%]" />
                    <col className="w-[15%]" />
                    <col className="w-[20%]" />
                    <col className="w-[15%]" />
                    <col className="w-[10%]" />
                  </colgroup>

                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="h-10 px-4 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => toggleSort("fullName")}
                          className="inline-flex items-center gap-1.5 hover:text-foreground"
                        >
                          Customer
                          {sort.key === "fullName" &&
                            (sort.direction === "asc" ? (
                              <ChevronUp className="size-3" />
                            ) : (
                              <ChevronDown className="size-3" />
                            ))}
                        </button>
                      </TableHead>

                      <TableHead className="h-10 px-4 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => toggleSort("company")}
                          className="inline-flex items-center gap-1.5 hover:text-foreground"
                        >
                          Company
                          {sort.key === "company" &&
                            (sort.direction === "asc" ? (
                              <ChevronUp className="size-3" />
                            ) : (
                              <ChevronDown className="size-3" />
                            ))}
                        </button>
                      </TableHead>

                      <TableHead className="h-10 px-5 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => toggleSort("ticketCount")}
                          className="inline-flex items-center gap-1.5 hover:text-foreground"
                        >
                          Tickets
                          {sort.key === "ticketCount" &&
                            (sort.direction === "asc" ? (
                              <ChevronUp className="size-3" />
                            ) : (
                              <ChevronDown className="size-3" />
                            ))}
                        </button>
                      </TableHead>

                      <TableHead className="h-10 px-5 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => toggleSort("lastActivityAt")}
                          className="inline-flex items-center gap-1.5 hover:text-foreground"
                        >
                          Last activity
                          {sort.key === "lastActivityAt" &&
                            (sort.direction === "asc" ? (
                              <ChevronUp className="size-3" />
                            ) : (
                              <ChevronDown className="size-3" />
                            ))}
                        </button>
                      </TableHead>

                      <TableHead className="h-10 px-4 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => toggleSort("createdAt")}
                          className="inline-flex items-center gap-1.5 hover:text-foreground"
                        >
                          Added
                          {sort.key === "createdAt" &&
                            (sort.direction === "asc" ? (
                              <ChevronUp className="size-3" />
                            ) : (
                              <ChevronDown className="size-3" />
                            ))}
                        </button>
                      </TableHead>

                      <TableHead className="h-10 px-4 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => toggleSort("csatScore")}
                          className="inline-flex items-center gap-1.5 hover:text-foreground"
                        >
                          CSAT
                          {sort.key === "csatScore" &&
                            (sort.direction === "asc" ? (
                              <ChevronUp className="size-3" />
                            ) : (
                              <ChevronDown className="size-3" />
                            ))}
                        </button>
                      </TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {pageRows.length === 0 ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={6}
                          className="h-24 text-center text-sm text-muted-foreground"
                        >
                          No customers match your filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      pageRows.map((customer) => (
                        <TableRow
                          key={customer.id}
                          className="cursor-pointer"
                          onClick={(event) => {
                            const target = event.target as HTMLElement;

                            if (target.closest("a, button, [role=menuitem]")) {
                              return;
                            }

                            router.push(customerPath(tenant, customer.id));
                          }}
                        >
                          <TableCell className="px-4 py-3">
                            <div className="flex min-w-0 items-center gap-3">
                              {avatar(customer)}

                              <div className="min-w-0">
                                <Link
                                  href={customerPath(tenant, customer.id)}
                                  className="block truncate text-sm font-medium text-foreground hover:text-brand-ink hover:underline"
                                >
                                  {customer.fullName}
                                </Link>

                                <p className="truncate text-xs text-muted-foreground">
                                  {customer.email}
                                </p>
                              </div>
                            </div>
                          </TableCell>

                          <TableCell className="px-4 py-3 text-sm">
                            <span className="block truncate">
                              {customer.company || (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </span>
                          </TableCell>

                          <TableCell className="px-5 py-3 text-sm font-medium tabular-nums">
                            {customer.ticketCount}
                          </TableCell>

                          <TableCell className="px-5 py-3 text-sm whitespace-nowrap text-muted-foreground">
                            {customer.lastActivityAt ? (
                              <span
                                title={formatCustomerDate(
                                  customer.lastActivityAt,
                                )}
                              >
                                {formatCustomerRelative(
                                  customer.lastActivityAt,
                                  now,
                                )}
                              </span>
                            ) : (
                              "—"
                            )}
                          </TableCell>

                          <TableCell className="px-4 py-3 text-sm whitespace-nowrap text-muted-foreground">
                            {formatCustomerDate(customer.createdAt)}
                          </TableCell>

                          <TableCell className="px-4 py-3 text-sm">
                            {customer.csatScore === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span
                                className={cn(
                                  "font-medium",
                                  csatTone(customer.csatScore),
                                )}
                              >
                                {formatCsatScore(customer.csatScore)}

                                <span className="sr-only">
                                  {csatScoreTitle(
                                    customer.csatScore,
                                    customer.csatCount,
                                  )}
                                </span>
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Showing{" "}
                  {filtered.length === 0
                    ? 0
                    : `${start + 1}–${Math.min(
                        start + PAGE_SIZE,
                        filtered.length,
                      )}`}{" "}
                  of {filtered.length}{" "}
                  {filtered.length === 1 ? "customer" : "customers"}
                  {hasActiveFilters ? " matching your filters" : ""}
                </span>

                <Pagination
                  page={safePage}
                  totalPages={totalPages}
                  onChange={setPage}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  return (
    <nav aria-label="Pagination" className="flex items-center gap-1.5">
      {/* Previous */}

      <Button
        variant="outline"
        size="icon"
        className="size-9"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="size-4" />
      </Button>

      {/* Pages */}

      {pageWindow(page, totalPages).map((value, index) =>
        value === "gap" ? (
          <span key={`gap-${index}`} className="px-1 text-muted-foreground">
            …
          </span>
        ) : (
          <Button
            key={value}
            variant={value === page ? "default" : "outline"}
            size="icon"
            className="size-9 tabular-nums"
            aria-current={value === page ? "page" : undefined}
            onClick={() => onChange(value)}
          >
            {value}
          </Button>
        ),
      )}

      {/* Next */}

      <Button
        variant="outline"
        size="icon"
        className="size-9"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight className="size-4" />
      </Button>
    </nav>
  );
}

/* ===============================================================
   EMPTY STATE
=============================================================== */

function EmptyState() {
  return (
    <div className="flex flex-col items-center px-5 py-16 text-center">
      <span
        aria-hidden
        className="flex size-14 items-center justify-center rounded-full bg-brand-accent/10 text-brand-accent ring-8 ring-brand-accent/5"
      >
        <UsersRound className="size-6" />
      </span>

      <p className="mt-5 text-base font-bold text-foreground">
        No customers yet
      </p>

      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        Customers appear here the first time they raise a request through your
        support portal.
      </p>
    </div>
  );
}
