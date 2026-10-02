"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, Search, UsersRound } from "lucide-react";

import { Pagination } from "@/components/shared/pagination";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  CUSTOMER_LIST_PAGE_SIZE,
  csatScoreTitle,
  csatTone,
  customerPath,
  DEFAULT_CUSTOMER_SORT,
  defaultSortDirection,
  formatCsatScore,
  formatCustomerDate,
  type CustomerListItem,
  type CustomerListPage,
  type CustomerSort,
  type CustomerSortKey,
} from "@/features/customers/types/customers";

import { formatRelativeTime, getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";

const HEAD =
  "h-10 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground";

/**
 * The list is searched, sorted and paged on the server; this component only
 * draws one page and writes the user's choices into the URL (`?q=&sort=&dir=
 * &page=`). A filtered page therefore survives a reload, a shared link and the
 * back button, and a tenant with thousands of customers costs the same as one
 * with ten.
 */
export default function CustomersTable({
  tenant,
  result,
  search,
  sort,
  now,
}: {
  tenant: string;
  result: CustomerListPage;
  /** The search the page was rendered for, already trimmed. */
  search: string;
  sort: CustomerSort;
  now: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = React.useTransition();

  const [term, setTerm] = React.useState(search);
  const [renderedSearch, setRenderedSearch] = React.useState(search);

  // The URL moved without the box -- the back button, or a link. Follow it,
  // unless the user is part-way through typing something else.
  if (search !== renderedSearch) {
    setRenderedSearch(search);

    if (term.trim() === renderedSearch) {
      setTerm(search);
    }
  }

  const { customers, total, tenantTotal, page, pageCount } = result;

  /** The current URL with some params changed; `null` removes one. */
  const hrefWith = React.useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(changes)) {
        if (value === null) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }

      const query = params.toString();

      return query ? `${pathname}?${query}` : pathname;
    },
    [pathname, searchParams],
  );

  // Debounced, so it still feels like typing into a filter. Compared trimmed:
  // "foo " is the search the server already ran, not a new one.
  React.useEffect(() => {
    const next = term.trim();

    if (next === search) {
      return;
    }

    const timer = setTimeout(() => {
      startTransition(() => {
        // The page goes with the search: page 3 of the old result is past the
        // end of a narrower one.
        router.replace(hrefWith({ q: next || null, page: null }), {
          scroll: false,
        });
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [term, search, router, hrefWith]);

  function sortHref(key: CustomerSortKey): string {
    const direction =
      sort.key === key
        ? sort.direction === "asc"
          ? "desc"
          : "asc"
        : defaultSortDirection(key);
    const isDefault =
      key === DEFAULT_CUSTOMER_SORT.key &&
      direction === DEFAULT_CUSTOMER_SORT.direction;

    return hrefWith({
      sort: isDefault ? null : key,
      dir: isDefault ? null : direction,
      page: null,
    });
  }

  const pageHref = (value: number) =>
    hrefWith({ page: value === 1 ? null : String(value) });

  const start = (page - 1) * CUSTOMER_LIST_PAGE_SIZE;

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
          {getInitials(customer.fullName, customer.email)}
        </AvatarFallback>
      </Avatar>
    );
  }

  function sortHeader(key: CustomerSortKey, label: string, padding: string) {
    const active = sort.key === key;

    return (
      <TableHead
        className={cn(HEAD, padding)}
        aria-sort={
          active
            ? sort.direction === "asc"
              ? "ascending"
              : "descending"
            : undefined
        }
      >
        <Link
          href={sortHref(key)}
          replace
          scroll={false}
          // text-muted-foreground explicitly: globals.css colours every <a>
          // with the brand, and the header text must stay grey like before.
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          {label}
          {active &&
            (sort.direction === "asc" ? (
              <ChevronUp className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            ))}
        </Link>
      </TableHead>
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

          {/* In the heading row, top-aligned with the title. type="search",
              so the browser draws its own clear button inside the field. */}
          <div className="relative w-full sm:w-80 lg:w-96">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />

            <Input
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search customers or company..."
              aria-label="Search customers"
              maxLength={200}
              className="h-10 bg-card pl-9 text-sm"
            />
          </div>
        </div>

        <div
          className={cn(
            "overflow-hidden rounded-lg border bg-card transition-opacity",
            isPending && "opacity-60",
          )}
          aria-busy={isPending || undefined}
        >
          {tenantTotal === 0 ? (
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
                      {sortHeader("fullName", "Customer", "px-4")}
                      {sortHeader("company", "Company", "px-4")}
                      {sortHeader("ticketCount", "Tickets", "px-5")}
                      {sortHeader("lastActivityAt", "Last activity", "px-5")}
                      {sortHeader("createdAt", "Added", "px-4")}
                      {sortHeader("csatScore", "CSAT", "px-4")}
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {customers.length === 0 ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={6}
                          className="h-24 text-center text-sm text-muted-foreground"
                        >
                          No customers match your search.
                        </TableCell>
                      </TableRow>
                    ) : (
                      customers.map((customer) => (
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
                                  className="block truncate text-sm font-medium text-foreground hover:text-brand-ink"
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
                                {formatRelativeTime(
                                  customer.lastActivityAt,
                                  now,
                                ) ?? "—"}
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

              {/* Stacked and centred below sm, opposite ends of one line from
                  sm -- the same shape as the team table's pager. */}
              <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row">
                <span className="text-center sm:text-left">
                  Showing{" "}
                  {total === 0
                    ? 0
                    : `${start + 1}–${Math.min(
                        start + CUSTOMER_LIST_PAGE_SIZE,
                        total,
                      )}`}{" "}
                  of {total} {total === 1 ? "customer" : "customers"}
                  {search ? " matching your search" : ""}
                </span>

                <Pagination
                  page={page}
                  pageCount={pageCount}
                  hrefFor={pageHref}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
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
