"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  isCustomerTab,
  type CustomerTab,
} from "@/features/customers/types/customers";
import { cn } from "@/lib/utils";

const TABS: ReadonlyArray<readonly [CustomerTab, string]> = [
  ["overview", "Overview"],
  ["tickets", "Tickets"],
];

/**
 * The tab strip on a customer's profile.
 *
 * It lives in the route's layout, and a layout is not re-rendered when only
 * the search params change -- which is what keeps the header and these tabs
 * on screen while the tab body loads. The active tab is read from the URL here
 * for the same reason: the layout never sees `?tab=`.
 */
export function CustomerTabs({
  baseHref,
  ticketTotal,
}: {
  /** The profile's own path, with no query. */
  baseHref: string;
  /** Shown beside "Tickets" when above zero. */
  ticketTotal: number;
}) {
  const searchParams = useSearchParams();
  const raw = searchParams.get("tab") ?? undefined;
  const current: CustomerTab = isCustomerTab(raw) ? raw : "overview";

  return (
    <nav aria-label="Customer sections" className="-mb-2 border-b">
      <ul className="-mb-px flex gap-6">
        {TABS.map(([value, label]) => {
          const active = value === current;

          return (
            <li key={value}>
              <Link
                href={
                  value === "overview" ? baseHref : `${baseHref}?tab=${value}`
                }
                aria-current={active ? "page" : undefined}
                scroll={false}
                className={cn(
                  "inline-flex items-center gap-1.5 border-b-2 pb-3 text-sm font-semibold transition-colors",
                  // The underline and the label are the same token, so the
                  // active state reads as one colour.
                  active
                    ? "border-brand-strong! text-brand-strong hover:text-brand-strong"
                    : "border-transparent! text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                {value === "tickets" && ticketTotal > 0 ? (
                  <span className="rounded-md bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
                    {ticketTotal}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
