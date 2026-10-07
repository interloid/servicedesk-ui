import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one look for a page's way back up: "← Customers", "← Your requests".
 * An arrow and the name of where it goes, in the brand ink, with no box -- it
 * is navigation above the page, not a control inside it.
 *
 * hover:text-brand-ink is restated because globals.css styles `a:hover` with
 * its own colour, which would otherwise win on hover.
 */
export function BackLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-semibold text-brand-ink hover:text-brand-ink focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
        className,
      )}
    >
      <ArrowLeft aria-hidden className="size-4" />
      {children}
    </Link>
  );
}
