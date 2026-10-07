import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { pageWindow } from "@/lib/pagination";
import { cn } from "@/lib/utils";

/**
 * The numbered pager: arrows either side, first and last page always, the
 * current one with a neighbour either side, and an ellipsis for each gap.
 *
 * One copy for every list, so a fix lands everywhere. Pass `hrefFor` to page by
 * URL (works from a Server Component, and the page survives a reload, a shared
 * link and the back button), or `onChange` from a Client Component that keeps
 * the page in state.
 *
 * Wrapping, and centred once it wraps: seven pages plus two arrows is wider
 * than a 320px phone.
 */
export function Pagination({
  page,
  pageCount,
  label = "Pagination",
  ...target
}: {
  page: number;
  pageCount: number;
  label?: string;
} & (
  | { hrefFor: (page: number) => string; onChange?: never }
  | { onChange: (page: number) => void; hrefFor?: never }
)) {
  const item = (
    value: number,
    children: ReactNode,
    options: { label?: string; current?: boolean; disabled?: boolean } = {},
  ) => (
    <PageItem
      key={options.label ?? value}
      href={target.hrefFor?.(value)}
      onClick={target.onChange ? () => target.onChange?.(value) : undefined}
      {...options}
    >
      {children}
    </PageItem>
  );

  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-center gap-1.5"
    >
      {item(page - 1, <ChevronLeft className="size-4" />, {
        label: "Previous page",
        disabled: page <= 1,
      })}

      {pageWindow(page, pageCount).map((value, index) =>
        value === "gap" ? (
          <span
            key={`gap-${index}`}
            aria-hidden
            className="px-1 text-muted-foreground"
          >
            …
          </span>
        ) : (
          item(value, value, { current: value === page })
        ),
      )}

      {item(page + 1, <ChevronRight className="size-4" />, {
        label: "Next page",
        disabled: page >= pageCount,
      })}
    </nav>
  );
}

/**
 * One page number or arrow. The ends of the range are drawn disabled rather
 * than omitted, so the pager keeps its width as you move through it.
 */
function PageItem({
  href,
  onClick,
  label,
  children,
  current = false,
  disabled = false,
}: {
  href?: string;
  onClick?: () => void;
  /** For the arrows; a numbered page is named by its own number. */
  label?: string;
  children: ReactNode;
  current?: boolean;
  disabled?: boolean;
}) {
  const variant = current ? "default" : "outline";

  if (href === undefined) {
    return (
      <Button
        variant={variant}
        size="icon"
        className="size-9 tabular-nums"
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
        aria-current={current ? "page" : undefined}
      >
        {children}
      </Button>
    );
  }

  return (
    <Button
      asChild
      variant={variant}
      size="icon"
      className={cn(
        "size-9 tabular-nums",
        // A link cannot be :disabled, so the button's disabled styling never
        // fires on one.
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <Link
        href={href}
        scroll={false}
        aria-label={label}
        aria-current={current ? "page" : undefined}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
      >
        {children}
      </Link>
    </Button>
  );
}
