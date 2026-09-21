import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import { X } from "lucide-react";
import { IconType, PillTone } from "../types";

const INVOICES_PER_PAGE = 5;
const PILL_TONES: Record<
  PillTone,
  { pill: string; dot: string; text: string }
> = {
  emerald: {
    pill: "bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
  },
  sky: {
    pill: "bg-sky-50 text-sky-700",
    dot: "bg-sky-500",
    text: "text-sky-700",
  },
  amber: {
    pill: "bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
    text: "text-amber-800",
  },
  red: {
    pill: "bg-red-50 text-red-700",
    dot: "bg-red-500",
    text: "text-red-700",
  },
  slate: {
    pill: "bg-slate-100 text-slate-600",
    dot: "bg-slate-400",
    text: "text-slate-500",
  },
};

export function IconTile({
  icon: Icon,
  tone,
}: {
  icon: IconType;
  tone: "teal" | "blue";
}) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg",
        tone === "teal"
          ? "bg-teal-50 text-teal-700"
          : "bg-blue-50 text-blue-600",
      )}
    >
      <Icon className="size-5" />
    </span>
  );
}

export function StatusPill({ tone, label }: { tone: PillTone; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold leading-5",
        PILL_TONES[tone].pill,
      )}
    >
      {label}
    </span>
  );
}

export function StatusText({
  tone,
  children,
}: {
  tone: PillTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-semibold",
        PILL_TONES[tone].text,
      )}
    >
      {children}
    </span>
  );
}

export function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: IconType;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2.5 text-slate-600">
        <Icon className="size-4 text-slate-400" />
        {label}
      </dt>
      <dd className="text-right font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

export function DashboardCard({
  icon,
  iconTone,
  label,
  children,
  footer,
}: {
  icon: IconType;
  iconTone: "teal" | "blue";
  label: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="flex h-full min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
      <header className="flex items-center gap-3">
        <IconTile icon={icon} tone={iconTone} />
        <h2 className="text-base font-semibold text-slate-900">{label}</h2>
      </header>
      <div className="mt-5 flex flex-1 flex-col">{children}</div>
      {footer && (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap [&>button]:w-full [&>button]:lg:w-auto [&>button]:lg:h-9">
          {footer}
        </div>
      )}
    </section>
  );
}

export function NoticeBanner({
  tone,
  icon: Icon,
  title,
  description,
  action,
  onDismiss,
}: {
  tone: "amber" | "red";
  icon: IconType;
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
}) {
  const styles =
    tone === "red"
      ? {
          box: "border-red-200 bg-red-50",
          tile: "bg-red-500",
          title: "text-red-950",
          text: "text-red-800",
        }
      : {
          box: "border-amber-200 bg-amber-50",
          tile: "bg-amber-500",
          title: "text-amber-950",
          text: "text-amber-800",
        };

  return (
    // ONE tree, not a mobile one and a desktop one.
    //
    // The two-tree version rendered `action` twice -- both copies live in the
    // DOM, so every banner button existed twice and the hidden one was still
    // focusable and still counted by tests and screen readers. It also let the
    // two layouts drift: `truncate` sat on the desktop title and description
    // only, quietly cutting any message longer than the one-liners it was
    // written for, while the same text wrapped fine on a phone.
    //
    // Nothing truncates now. A notice exists to be read, and these say things
    // like which date access ends on -- clipping that is worse than a banner
    // two lines taller.
    <div
      className={cn(
        "relative rounded-xl border px-4 py-3 sm:px-5 sm:py-4",
        styles.box,
      )}
    >
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notice"
          className={cn(
            "absolute right-2 top-1/2 z-10 -translate-y-1/2",
            "flex size-7 items-center justify-center rounded-md",
            "text-current/60 transition-colors",
            "hover:bg-black/5 hover:text-current",
            "focus:outline-none focus:ring-2 focus:ring-current/20",
          )}
        >
          <X className="size-4" />
        </button>
      )}

      <div
        className={cn(
          "flex flex-col gap-3",
          "sm:flex-row sm:items-center sm:gap-4",
          // Keeps the text and the action clear of the dismiss button at
          // every width, rather than only on the breakpoint that had it.
          onDismiss && "pr-7 sm:pr-8",
        )}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg text-white",
              styles.tile,
            )}
          >
            <Icon className="size-4" />
          </span>

          {/* min-w-0 is what lets the text wrap instead of forcing the flex
              row wider than its container. */}
          <div className="min-w-0 flex-1">
            <h3
              className={cn(
                "text-sm font-semibold leading-5 break-words",
                styles.title,
              )}
            >
              {title}
            </h3>

            <p
              className={cn("mt-1 text-xs leading-5 break-words", styles.text)}
            >
              {description}
            </p>
          </div>
        </div>

        {action && <div className="w-full shrink-0 sm:w-auto">{action}</div>}
      </div>
    </div>
  );
}

export function PayPalMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="#003087"
    >
      <path d="M7.016 19.198h-4.2a.562.562 0 0 1-.555-.65L5.093.584A.692.692 0 0 1 5.776 0h7.222c3.417 0 5.904 2.488 5.846 5.5-.006.25-.027.5-.066.747A6.794 6.794 0 0 1 12.071 12H8.743a.69.69 0 0 0-.682.583l-.325 2.056-.013.083-.692 4.39-.015.087z" />
      <path
        fill="#0070e0"
        d="M19.79 6.142c-.01.087-.01.175-.023.261a7.76 7.76 0 0 1-7.695 6.598H9.007l-.283 1.795-.013.083-.692 4.39-.134.843-.014.088H6.86l-.497 3.15a.562.562 0 0 0 .555.65h3.94c.34 0 .63-.249.683-.585l.952-6.031a.692.692 0 0 1 .683-.584h2.126a6.793 6.793 0 0 0 6.707-5.752c.306-1.95-.466-3.744-1.84-4.84z"
      />
    </svg>
  );
}

function CardSkeleton() {
  return (
    <div className="flex h-full min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-lg bg-slate-100" />
        <Skeleton className="h-4 w-28 bg-slate-100" />
      </div>

      <div className="mt-5 flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-8 w-4/5 max-w-44 bg-slate-100" />
            <Skeleton className="mt-1 h-8 w-28 bg-slate-100" />
          </div>
          <Skeleton className="mt-1 h-6 w-16 shrink-0 rounded-full bg-slate-100" />
        </div>

        <Skeleton className="mt-2 h-4 w-3/4 bg-slate-100" />

        <div className="mt-5 space-y-3 border-t border-slate-100 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-4 bg-slate-100" />
              <Skeleton className="h-5 w-20 bg-slate-100" />
            </div>
            <Skeleton className="h-5 w-16 bg-slate-100" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-4 bg-slate-100" />
              <Skeleton className="h-5 w-24 bg-slate-100" />
            </div>
            <Skeleton className="h-5 w-20 bg-slate-100" />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <Skeleton className="h-10 w-full rounded-lg bg-slate-100 lg:h-9 lg:w-40" />
      </div>
    </div>
  );
}

export function LoadingState({ showBanner }: { showBanner: boolean }) {
  return (
    <div className="h-full p-4 font-sans text-slate-900 sm:p-8">
      <div className="mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-32 bg-slate-200" />
            <Skeleton className="h-5 w-72 max-w-full bg-slate-200" />
          </div>
          <Skeleton className="h-10 w-full rounded-lg bg-slate-200 sm:w-36" />
        </div>
        {showBanner && (
          <Skeleton className="h-20 w-full rounded-xl bg-slate-100 lg:h-16" />
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <header className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-lg bg-slate-100" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-28 bg-slate-100" />
                <Skeleton className="h-3 w-16 bg-slate-100" />
              </div>
            </div>
          </header>
          <div className="border-t border-slate-100">
            <div className="flex items-center gap-4 border-b border-slate-100 bg-slate-50 px-4 py-3.5 sm:px-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-3 bg-slate-100 first:w-16 nth-2:w-20 nth-3:flex-1 nth-4:w-14 nth-5:w-24"
                />
              ))}
            </div>
            <div className="divide-y divide-slate-100">
              {Array.from({ length: INVOICES_PER_PAGE }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-4 py-4 sm:px-6"
                >
                  <Skeleton className="h-3 w-16 shrink-0 bg-slate-100" />
                  <Skeleton className="h-3 w-20 shrink-0 bg-slate-100" />
                  <Skeleton className="hidden h-3 flex-1 bg-slate-100 sm:block" />
                  <Skeleton className="h-3 w-14 shrink-0 bg-slate-100" />
                  <Skeleton className="h-5 w-14 shrink-0 rounded-full bg-slate-100" />
                </div>
              ))}
            </div>
            <nav className="flex flex-col gap-3 border-t border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <Skeleton className="h-4 w-40 bg-slate-100" />
              <div className="flex items-center justify-between gap-2 sm:justify-end sm:gap-2">
                <Skeleton className="size-9 rounded-lg bg-slate-100" />
                <div className="hidden items-center gap-1.5 sm:flex">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton
                      key={i}
                      className="size-9 rounded-lg bg-slate-100"
                    />
                  ))}
                </div>
                <Skeleton className="size-9 rounded-lg bg-slate-100" />
              </div>
            </nav>
          </div>
        </section>
      </div>
    </div>
  );
}
