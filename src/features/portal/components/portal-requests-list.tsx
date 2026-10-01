"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Inbox,
  Plus,
  Search,
  SearchX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PORTAL_ROUTES,
  PORTAL_STATE_LABEL,
  portalPath,
  PORTAL_REQUEST_SORTS,
  portalRequestPath,
  type PortalRequest,
  type PortalRequestPage,
  type PortalRequestSort,
  type PortalRequestState,
  type PortalRequestSummary,
} from "@/features/portal/portal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const STATE_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "waiting_on_you", label: "Waiting on you" },
  { value: "resolved", label: "Resolved" },
];

const STATE_BADGE: Record<PortalRequestState, string> = {
  open: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  waiting_on_you:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  resolved:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
};

export function PortalRequestsList({
  tenantSlug,
  tenantName,
  result,
  search,
  state,
  sort,
}: {
  tenantSlug: string;
  tenantName: string;
  result: PortalRequestPage;
  search: string;
  state: string;
  sort: PortalRequestSort;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [term, setTerm] = useState(search);

  const { requests, total, page, perPage } = result;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // Filtering happens on the server so the result survives a refresh and a
  // shared link. The input is debounced rather than submitted so it still feels
  // like typing into a filter.
  useEffect(() => {
    if (term === search) {
      return;
    }

    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());

      // Page dropped, as on every other filter change: a narrower result set is
      // shorter, so page 3 of the old one is a page past the end of the new.
      params.delete("page");

      if (term.trim()) {
        params.set("q", term.trim());
      } else {
        params.delete("q");
      }

      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [term, search, pathname, router, searchParams]);

  /** Sets one filter or sort, dropping it when it is back at its default. */
  function setParam(key: string, value: string, fallback: string) {
    const params = new URLSearchParams(searchParams.toString());

    // The page goes with the filter that shrank the list. Carrying it over is
    // the standard pagination bug: the reader asks for "open" on page 4, gets
    // an empty list and a pager reading "Page 4 of 1", and concludes the
    // filter is broken rather than that they were past the end.
    params.delete("page");

    if (value === fallback) {
      params.delete(key);
    } else {
      params.set(key, value);
    }

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  /**
   * Moves between pages of the same result set, so unlike setParam this keeps
   * every filter and sort in the URL. `scroll: false` is deliberate: the effect
   * below brings the reader to the top of the list, which is where they need to
   * be, rather than to the top of the page -- the heading and the filters are
   * above it and the reader has just seen them.
   */
  function goToPage(next: number) {
    if (next === page || next < 1 || next > totalPages) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());

    // Page 1 is the default, so it is left off the URL. A shared link then
    // reads "?state=open" rather than "?state=open&page=1".
    if (next === 1) {
      params.delete("page");
    } else {
      params.set("page", String(next));
    }

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  const listRef = useRef<HTMLDivElement>(null);
  const shownPage = useRef(page);

  useEffect(() => {
    if (shownPage.current === page) {
      return;
    }

    shownPage.current = page;
    // scroll-mt-20 on the list covers the sticky portal header, so the first
    // row lands below it instead of under it. The reduced-motion check is
    // because scrollIntoView's `smooth` ignores the preference on its own.
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    listRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
  }, [page]);

  function onStateChange(next: string) {
    setParam("state", next, "all");
  }

  function onSortChange(next: string) {
    setParam("sort", next, "updated");
  }

  function clearFilters() {
    setTerm("");

    // The sort is a preference, not a filter, so it survives "clear".
    startTransition(() => {
      router.replace(
        sort === "updated" ? pathname : `${pathname}?sort=${sort}`,
        { scroll: false },
      );
    });
  }

  const isFiltered = Boolean(search) || state !== "all";

  // Nothing raised yet: a search box and a status filter over an empty list
  // are controls with nothing to act on, so the empty state stands alone.
  const showFilters = total > 0 || isFiltered;

  return (
    <div className="mx-auto w-full max-w-7xl md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-[1.75rem]">
            Your requests
          </h1>
          <p className="text-sm leading-[1.6] text-muted-foreground">
            Track and manage everything you&apos;ve raised with {tenantName},
            and reply without leaving this page.
          </p>
        </div>

        <Button asChild size="lg" className="h-11 px-5 font-semibold">
          <Link href={portalPath(tenantSlug, PORTAL_ROUTES.NEW_REQUEST)}>
            <Plus aria-hidden className="size-4" />
            New request
          </Link>
        </Button>
      </div>

      {showFilters ? (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <label htmlFor="portal-search" className="sr-only">
              Search your requests
            </label>
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="portal-search"
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search your requests…"
              className="h-12 rounded-xl bg-card pl-11 text-sm shadow-xs"
            />
          </div>

          <label htmlFor="portal-state" className="sr-only">
            Status
          </label>
          <Select value={state} onValueChange={onStateChange}>
            <SelectTrigger
              id="portal-state"
              className="min-h-12 w-full rounded-xl bg-card px-4 text-sm shadow-xs focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/25 sm:w-52"
            >
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>

            <SelectContent side="bottom" align="end" position="popper">
              {STATE_FILTERS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="p-3"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {total > 0 ? (
        <div className="mt-6 flex items-center justify-between gap-3">
          <p
            aria-live="polite"
            className="text-sm font-medium text-muted-foreground"
          >
            {/* The total, not the length of the page: "87 requests" is what the
                reader is choosing between, and it is the number that has to
                change when a filter narrows the list. */}
            {total === 1 ? "1 request" : `${total} requests`}
          </p>

          <Select value={sort} onValueChange={onSortChange}>
            <SelectTrigger
              aria-label="Sort requests"
              className="h-8 w-auto gap-1.5 border-0 bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span>
                Sort by:{" "}
                <span className="font-semibold text-foreground">
                  {PORTAL_REQUEST_SORTS[sort]}
                </span>
              </span>
            </SelectTrigger>

            <SelectContent side="bottom" align="end" position="popper">
              {Object.entries(PORTAL_REQUEST_SORTS).map(([value, label]) => (
                <SelectItem key={value} value={value} className="p-2">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div
        ref={listRef}
        // scroll-mt-20, because the portal header is sticky: without it the
        // page-change scroll parks the first row underneath the header.
        className={cn(
          "scroll-mt-20 flex flex-col gap-3 transition-opacity",
          total > 0 ? "mt-3" : "mt-5",
          isPending && "opacity-60",
        )}
      >
        {requests.length === 0 ? (
          <EmptyState
            tenantSlug={tenantSlug}
            isFiltered={isFiltered}
            onClearFilters={clearFilters}
          />
        ) : (
          requests.map((request) => (
            <RequestRow
              key={request.id}
              tenantSlug={tenantSlug}
              request={request}
            />
          ))
        )}
      </div>

      {totalPages > 1 ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          perPage={perPage}
          onChange={goToPage}
        />
      ) : null}
    </div>
  );
}

/**
 * Previous / Next with the position spelled out, rather than a row of numbered
 * buttons. Two reasons, and the first is the one that decides it: the count
 * behind the list is whatever a customer has raised with one company, which can
 * be a handful or a few hundred, and a fixed strip of numbers either needs
 * ellipsis logic and a window that slides, or gets long enough to wrap on a
 * phone. Prev/Next and "Page 3 of 12" work at every total, and the counter says
 * where you are without you having to count the buttons.
 *
 * Rendered only when there is more than one page, so a list of five requests
 * does not carry a pager that goes nowhere.
 *
 * perPage comes from the page the server read rather than from
 * PORTAL_REQUESTS_PER_PAGE: totalPages above is already computed from it, and
 * a hardcoded copy of the same number is a second place for the two to drift.
 */
function Pagination({
  page,
  totalPages,
  total,
  perPage,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  /** The size the server actually paged by, which is what this range is of. */
  perPage: number;
  onChange: (page: number) => void;
}) {
  return (
    <nav
      aria-label="Requests pages"
      className="mt-6 flex flex-col items-center gap-3 border-t pt-6 sm:flex-row sm:justify-between"
    >
      <p className="text-xs text-muted-foreground">
        Showing{" "}
        <span className="font-semibold tabular-nums text-foreground">
          {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)}
        </span>{" "}
        of{" "}
        <span className="font-semibold tabular-nums text-foreground">
          {total}
        </span>
      </p>

      <div className="flex items-center gap-2.5">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-11 px-4 font-semibold"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft aria-hidden className="size-4" />
          Previous
        </Button>

        <p
          // Announced, so a screen reader hears the new position when the page
          // changes -- the buttons' labels alone ("Next") do not say it moved.
          aria-live="polite"
          className="min-w-24 text-center text-sm font-semibold tabular-nums text-foreground"
        >
          Page {page} of {totalPages}
        </p>

        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-11 px-4 font-semibold"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          Next
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      </div>
    </nav>
  );
}

function RequestRow({
  tenantSlug,
  request,
}: {
  tenantSlug: string;
  request: PortalRequestSummary;
}) {
  const timestamp = useMemo(() => describeTimestamps(request), [request]);

  return (
    <Link
      href={portalRequestPath(tenantSlug, request.id)}
      className={cn(
        "group relative flex items-start gap-4 rounded-2xl border bg-card p-4 text-foreground shadow-xs transition-all sm:p-5",
        "hover:-translate-y-0.5 hover:border-brand-accent/40 hover:text-foreground hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)]",
        "focus-visible:ring-2 focus-visible:ring-(--brand-accent)/30 focus-visible:outline-none",
      )}
    >
      <span
        aria-hidden
        className="hidden size-12 shrink-0 items-center justify-center rounded-xl bg-brand-accent/10 text-brand-accent sm:flex"
      >
        <FileText className="size-5" />
      </span>

      <div className="min-w-0 flex-1">
        {/* The badge is taken out of the flow and pinned to the card's corner,
            because in the flow it could never reach it: the chevron is the last
            column of this flex row, so a badge in the flow is always its width
            plus the row's gap plus the card's padding further in -- 57px at
            p-5, which is not a corner. Absolute, it lands on the padding edge,
            which is the corner. */}
        <span
          className={cn(
            // right-5/top-5 at every width, not p-4 below sm: the card's padding
            // is 16px on a phone and 20px above it, so a pill inset by the same
            // rule sits 4px nearer the border on the screen where the card is
            // smallest and the pill is widest. One inset for the pill, and it is
            // the looser of the two.
            // whitespace-nowrap because the pill is out of the flow: at a scaled
            // up font size a wrapped second line would sit on top of the title
            // instead of just making the card taller.
            "absolute right-5 top-5 shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
            STATE_BADGE[request.state],
          )}
        >
          {PORTAL_STATE_LABEL[request.state]}
        </span>

        {/* h-6 so the number's line is as tall as the badge and the two share a
            centre; pe-28 reserves the corner's width, so a long request number
            truncates instead of running underneath the badge. 28 is the widest
            badge ("Waiting on you") plus its margin.
            block rather than flex: `truncate` needs the ellipsis, and text-overflow
            is ignored on a flex container, so the old `flex items-center` clipped
            the number hard against the badge instead of ellipsising it. The line
            is the height of the bar either way, so nothing else moves. */}
        <p className="block h-6 truncate pe-28 text-xs font-medium leading-6 text-muted-foreground">
          #{request.number ?? "-"}
        </p>

        <h2 className="mt-1 truncate text-base font-bold text-foreground">
          {request.subject}
        </h2>

        {request.preview ? (
          <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
            {request.preview}
          </p>
        ) : null}

        {/* Relative times are computed from Date.now(), so the server's
            render and the client's can differ by a minute. The text is
            cosmetic; suppressing beats shipping a mount-gated placeholder. */}
        <p
          suppressHydrationWarning
          className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Clock3 aria-hidden className="size-3.5 shrink-0" />
          {timestamp}
        </p>
      </div>
    </Link>
  );
}

function EmptyState({
  tenantSlug,
  isFiltered,
  onClearFilters,
}: {
  tenantSlug: string;
  isFiltered: boolean;
  onClearFilters: () => void;
}) {
  const Icon = isFiltered ? SearchX : Inbox;

  return (
    <div className="flex flex-col items-center rounded-2xl border bg-card px-5 py-14 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.05)] sm:py-20">
      <span
        aria-hidden
        className="flex size-16 items-center justify-center rounded-full bg-brand-accent/10 text-brand-accent ring-8 ring-brand-accent/5"
      >
        <Icon className="size-7" />
      </span>

      <p className="mt-6 text-lg font-bold text-foreground">
        {isFiltered ? "Nothing matches those filters" : "No requests yet"}
      </p>

      <p className="mt-1.5 max-w-sm text-sm leading-[1.6] text-muted-foreground">
        {isFiltered
          ? "Try a different status, or clear the search to see everything you've raised."
          : "When you raise something with our team it shows up here with its status and every reply."}
      </p>

      {/* Stacked full-width on a phone so neither label is squeezed; side by
          side from sm up, as in the design. */}
      <div className="mt-6 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
        {isFiltered ? (
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="h-11 px-5 font-semibold text-brand-ink hover:text-brand-ink"
            onClick={onClearFilters}
          >
            Clear filters
          </Button>
        ) : (
          <>
            <Button asChild size="lg" className="h-11 px-5 font-semibold">
              <Link href={portalPath(tenantSlug, PORTAL_ROUTES.NEW_REQUEST)}>
                Submit your first request
              </Link>
            </Button>

            {/* Colour named on the anchor: globals.css paints every `a` in
                --primary, which the outline variant would otherwise inherit. */}
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-11 px-5 font-semibold text-brand-ink hover:text-brand-ink"
            >
              <Link href={portalPath(tenantSlug, PORTAL_ROUTES.HELP)}>
                Browse help centre
              </Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

function describeTimestamps(request: PortalRequest): string {
  const opened = new Date(request.createdAt);
  const openedLabel = isToday(opened)
    ? `today, ${TIME_FORMAT.format(opened)}`
    : DATE_FORMAT.format(opened);

  if (request.state === "resolved" && request.resolvedAt) {
    return `Opened ${openedLabel} · Resolved ${relative(new Date(request.resolvedAt))}`;
  }

  return `Opened ${openedLabel} · Updated ${relative(new Date(request.updatedAt))}`;
}

function isToday(value: Date): boolean {
  const now = new Date();

  return (
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth() &&
    value.getDate() === now.getDate()
  );
}

function relative(value: Date): string {
  const minutes = Math.round((Date.now() - value.getTime()) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;

  return DATE_FORMAT.format(value);
}
