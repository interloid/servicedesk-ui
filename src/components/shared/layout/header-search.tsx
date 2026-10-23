"use client";

import { CornerDownLeft, Loader2, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { searchTicketsAction } from "@/features/tickets/actions/tickets.actions";
import type { TicketSearchHit } from "@/features/tickets/services/tickets.service";
import {
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from "@/features/tickets/types/tickets.types";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { formatRelativeTime } from "@/lib/format";
import { stripTenantPrefix, tenantPath, TENANT_ROUTES } from "@/lib/tenancy";
import { cn } from "@/lib/utils";

/** Quiet time after the last keystroke before the results are fetched. */
const SEARCH_DEBOUNCE_MS = 200;

/** The tickets table's priority dot colours. */
const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-emerald-600",
};

type Results =
  | { state: "idle" }
  | { state: "loading"; hits: TicketSearchHit[] }
  | { state: "done"; hits: TicketSearchHit[] }
  | { state: "error"; message: string };

/**
 * Searches the tenant's tickets: matches show under the box as you type and
 * open on click (or arrow keys + Enter); Enter with none picked opens the
 * tickets list with ?search=, the same param its own search box writes.
 */
export function HeaderSearch({
  className,
  autoFocus = false,
  shortcut = true,
  onSearch,
}: {
  className?: string;
  autoFocus?: boolean;
  /** Off for a second copy (the mobile popover), so "/" is bound once. */
  shortcut?: boolean;
  /** After navigating, e.g. to close the popover holding it. */
  onSearch?: () => void;
}) {
  const [query, setQuery] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Results>({ state: "idle" });
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the newest request may write results: an older, slower one would
  // show matches for text that is no longer in the box.
  const requestRef = useRef(0);
  const listId = useId();
  const pathname = usePathname();
  const router = useRouter();
  const slug = stripTenantPrefix(pathname)?.slug;

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // Below lg the box is display:none; "/" then stays an ordinary key.
  useKeyboardShortcut(
    "/",
    () => {
      const input = inputRef.current;
      if (!input || input.getClientRects().length === 0) return false;
      input.focus();
    },
    shortcut,
  );

  const runSearch = (value: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const term = value.trim();
    const request = ++requestRef.current;
    setActive(-1);

    if (!term || !slug) {
      setResults({ state: "idle" });
      return;
    }

    setResults((prev) => ({
      state: "loading",
      hits: prev.state === "done" || prev.state === "loading" ? prev.hits : [],
    }));
    timerRef.current = setTimeout(async () => {
      const result = await searchTicketsAction(slug, term);
      if (request !== requestRef.current) return;
      setResults(
        result.success
          ? { state: "done", hits: result.tickets }
          : { state: "error", message: result.error },
      );
    }, SEARCH_DEBOUNCE_MS);
  };

  const reset = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    requestRef.current++;
    setQuery("");
    setResults({ state: "idle" });
    setActive(-1);
    setOpen(false);
  };

  const ticketHref = (id: string) =>
    slug ? tenantPath(slug, `${TENANT_ROUTES.TICKETS}/${id}`) : "#";

  const afterNavigate = () => {
    reset();
    inputRef.current?.blur();
    onSearch?.();
  };

  const hits =
    results.state === "done" || results.state === "loading" ? results.hits : [];

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const term = query.trim();
    if (!term || !slug) return;

    const picked = hits[active];
    router.push(
      picked
        ? ticketHref(picked.id)
        : `${tenantPath(slug, TENANT_ROUTES.TICKETS)}?search=${encodeURIComponent(term)}`,
    );
    afterNavigate();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (!hits.length) return;
    event.preventDefault();
    setOpen(true);
    setActive((current) => {
      if (event.key === "ArrowDown") {
        return current >= hits.length - 1 ? 0 : current + 1;
      }
      return current <= 0 ? hits.length - 1 : current - 1;
    });
  };

  const showPanel = open && query.trim().length > 0 && !!slug;
  const busy = results.state === "loading";

  return (
    <Popover open={showPanel} onOpenChange={setOpen}>
      <form role="search" onSubmit={onSubmit} className="contents">
        <PopoverAnchor asChild>
          <InputGroup ref={anchorRef} className={className}>
            <InputGroupAddon align="inline-start" className="pl-3">
              {busy ? (
                <Loader2
                  className="size-4 shrink-0 animate-spin text-muted-foreground"
                  aria-hidden
                />
              ) : (
                <Search
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              )}
            </InputGroupAddon>

            <InputGroupInput
              ref={inputRef}
              type="search"
              role="combobox"
              aria-label="Search tickets"
              aria-expanded={showPanel}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                active >= 0 ? `${listId}-${active}` : undefined
              }
              autoComplete="off"
              placeholder="Search tickets"
              autoFocus={autoFocus}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
                runSearch(event.target.value);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              className="text-sm [&::-webkit-search-cancel-button]:appearance-none"
            />

            <InputGroupAddon align="inline-end" className="pr-2">
              {query ? (
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Clear search"
                  onClick={() => {
                    reset();
                    inputRef.current?.focus();
                  }}
                >
                  <X aria-hidden />
                </InputGroupButton>
              ) : shortcut ? (
                <kbd className="rounded-sm border border-border bg-card px-1.5 py-0.5 font-mono text-xs leading-none text-muted-foreground">
                  /
                </kbd>
              ) : null}
            </InputGroupAddon>
          </InputGroup>
        </PopoverAnchor>
      </form>

      <PopoverContent
        align="start"
        sideOffset={8}
        // Typing carries on in the box while the panel is open.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) {
            event.preventDefault();
          }
        }}
        className="w-(--radix-popover-trigger-width) min-w-[min(22rem,calc(100vw-2rem))] gap-0 overflow-hidden rounded-xl border border-border p-0 shadow-lg ring-0"
      >
        <div
          id={listId}
          role="listbox"
          aria-label="Matching tickets"
          className="max-h-[min(26rem,60vh)] overflow-y-auto overscroll-contain p-1.5"
        >
          {results.state === "error" ? (
            <p className="px-3 py-6 text-center text-sm text-destructive">
              {results.message}
            </p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {busy ? "Searching…" : "No tickets match."}
            </p>
          ) : (
            hits.map((hit, index) => (
              <Link
                key={hit.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                href={ticketHref(hit.id)}
                onClick={afterNavigate}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-2.5 py-2 outline-none transition-colors",
                  index === active ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-mono text-xs font-semibold text-primary">
                  #{hit.number}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {hit.subject}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        PRIORITY_DOT[hit.priority] ?? "bg-slate-400",
                      )}
                      title={TICKET_PRIORITY_LABELS[hit.priority]}
                    />
                    <span className="truncate">{hit.requester_name}</span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">
                      {TICKET_STATUS_LABELS[hit.status] ?? hit.status}
                    </span>
                  </span>
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                  {formatRelativeTime(hit.updated_at)}
                </span>
              </Link>
            ))
          )}
        </div>

        <Link
          href={
            slug
              ? `${tenantPath(slug, TENANT_ROUTES.TICKETS)}?search=${encodeURIComponent(query.trim())}`
              : "#"
          }
          onClick={afterNavigate}
          className="flex items-center justify-between gap-2 border-t border-border bg-muted/50 px-4 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <span className="truncate">
            See all tickets for{" "}
            <span className="font-medium text-foreground">
              “{query.trim()}”
            </span>
          </span>
          <kbd className="flex items-center gap-1 rounded-sm border border-border bg-card px-1.5 py-0.5 font-mono leading-none">
            <CornerDownLeft className="size-3" aria-hidden />
          </kbd>
        </Link>
      </PopoverContent>
    </Popover>
  );
}
