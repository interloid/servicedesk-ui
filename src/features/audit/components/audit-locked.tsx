import Link from "next/link";
import {
  CreditCard,
  Crown,
  FileText,
  Lock,
  ShieldAlert,
  Users,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PRIMARY =
  "h-11 gap-2 rounded-lg bg-brand-accent px-5 text-sm font-semibold text-brand-accent-foreground shadow-none hover:bg-brand-accent/90";

/** The events the illustration names, placed around the central card. */
const FEATURES: {
  label: string;
  icon: LucideIcon;
  tone: string;
  position: string;
}[] = [
  {
    label: "Authentication events",
    icon: UserRound,
    tone: "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
    position: "left-[4%] top-[4%]",
  },
  {
    label: "Role changes",
    icon: Users,
    tone: "bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
    position: "right-[4%] top-[4%]",
  },
  {
    label: "SLA policy changes",
    icon: FileText,
    tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    position: "left-0 top-[46%]",
  },
  {
    label: "Failed sign-ins",
    icon: ShieldAlert,
    tone: "bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    position: "right-0 top-[46%]",
  },
  {
    label: "Billing changes",
    icon: CreditCard,
    tone: "bg-pink-50 text-pink-700 dark:bg-pink-950/60 dark:text-pink-300",
    position: "left-1/2 bottom-0 -translate-x-1/2 translate-x-[10%]",
  },
];

function Illustration() {
  return (
    <div
      className="relative hidden h-64 w-full max-w-[560px] lg:block"
      aria-hidden
    >
      <svg
        className="absolute inset-0 size-full text-emerald-300 dark:text-emerald-800"
        viewBox="0 0 560 256"
        fill="none"
        preserveAspectRatio="none"
      >
        <g stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 5">
          <path d="M150 34 C 200 34, 210 80, 250 90" />
          <path d="M410 34 C 360 34, 350 80, 310 90" />
          <path d="M150 132 L 230 128" />
          <path d="M410 132 L 330 128" />
          <path d="M290 200 L 290 222" />
        </g>
      </svg>

      <div className="absolute top-1/2 left-1/2 flex w-40 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 shadow-sm">
        <span className="flex size-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
          <Lock className="size-4" />
        </span>
        <p className="text-sm font-semibold">Audit log</p>
        <div className="flex w-full flex-col gap-1.5">
          {[80, 100, 64].map((width) => (
            <div key={width} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-muted-foreground/25" />
              <span
                className="h-1.5 rounded-full bg-muted-foreground/20"
                style={{ width: `${width}%` }}
              />
            </div>
          ))}
        </div>
      </div>

      {FEATURES.map((feature) => (
        <div
          key={feature.label}
          className={cn(
            "absolute flex max-w-40 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium",
            feature.tone,
            feature.position,
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/70 dark:bg-black/20">
            <feature.icon className="size-4" />
          </span>
          {feature.label}
        </div>
      ))}
    </div>
  );
}

/** Rows for the blurred preview. Decorative: no real events are sent. */
const PREVIEW_ROWS = [
  "bg-sky-200",
  "bg-emerald-200",
  "bg-red-200",
  "bg-sky-200",
  "bg-emerald-200",
  "bg-orange-200",
];

/**
 * What a workspace without the Business plan sees: what the log offers, a
 * blurred preview of it, and the way to upgrade. No audit data is read for
 * this screen.
 */
export function AuditLocked({
  plansHref,
  canUpgrade,
}: {
  plansHref: string;
  canUpgrade: boolean;
}) {
  return (
    <div className="h-full overflow-y-auto p-4 font-sans text-slate-900 sm:p-6 lg:p-8 dark:text-foreground">
      <div className="mx-auto flex w-full flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">Audit log</h1>
              <Badge className="gap-1 border-none bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                <Lock className="size-3" aria-hidden />
                Business plan only
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Track administrative and security-related activity across your
              workspace.
            </p>
          </div>

          {canUpgrade && (
            <Button
              asChild
              variant="outline"
              className="h-10 gap-2 rounded-lg border-brand-accent bg-card px-4 font-semibold text-brand-accent shadow-none"
            >
              <Link href={plansHref}>
                <Crown className="size-4" aria-hidden />
                View plans
              </Link>
            </Button>
          )}
        </div>

        <section className="flex flex-col items-center gap-8 rounded-[14px] border border-emerald-100 bg-gradient-to-br from-emerald-50/80 via-card to-card p-6 sm:p-10 lg:flex-row lg:justify-between dark:border-emerald-950 dark:from-emerald-950/30">
          <div className="flex max-w-xl flex-col gap-4 sm:flex-row sm:gap-5">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300">
              <Crown className="size-6" aria-hidden />
            </span>
            <div className="flex flex-col gap-3">
              <h2 className="text-2xl font-bold tracking-tight">
                Audit log is available on the Business plan
              </h2>
              <p className="text-sm text-muted-foreground sm:text-base">
                Get full visibility into authentication events, role changes,
                SLA policy changes, failed sign-ins, and billing changes with 12
                months of audit history.
              </p>
              {canUpgrade ? (
                <div className="mt-2 flex flex-wrap gap-3">
                  <Button asChild className={PRIMARY}>
                    <Link href={plansHref}>
                      <Crown className="size-4" aria-hidden />
                      Upgrade to Business
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="h-11 rounded-lg bg-card px-5 font-semibold shadow-none"
                  >
                    <Link href={plansHref}>View plan details</Link>
                  </Button>
                </div>
              ) : (
                <p className="mt-1 text-sm font-medium">
                  Ask a Tenant Admin to upgrade the workspace to Business.
                </p>
              )}
            </div>
          </div>

          <Illustration />
        </section>

        <section className="relative overflow-hidden rounded-[14px] border border-border bg-card">
          <div
            className="pointer-events-none select-none blur-[3px]"
            aria-hidden
          >
            <div className="flex flex-wrap gap-3 border-b border-border p-4">
              <div className="h-10 w-72 rounded-lg border border-border" />
              {[1, 2, 3, 4].map((index) => (
                <div
                  key={index}
                  className="h-10 w-40 rounded-lg border border-border"
                />
              ))}
            </div>
            <div className="h-11 border-b border-border bg-muted/50" />
            {PREVIEW_ROWS.map((tone, index) => (
              <div
                key={index}
                className="flex items-center gap-6 border-b border-border px-4 py-4 last:border-b-0"
              >
                <div className="h-3 w-28 rounded bg-muted" />
                <div className="size-8 rounded-full bg-muted" />
                <div className="h-3 w-24 rounded bg-muted" />
                <div className={cn("h-5 w-16 rounded-md opacity-60", tone)} />
                <div className="h-5 w-20 rounded-md bg-violet-200 opacity-50" />
                <div className="h-3 flex-1 rounded bg-muted" />
                <div className="h-5 w-16 rounded-md bg-emerald-200 opacity-50" />
                <div className="hidden h-3 w-24 rounded bg-muted md:block" />
              </div>
            ))}
          </div>

          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card/40 p-6 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Lock className="size-7" aria-hidden />
            </span>
            <h2 className="text-lg font-semibold">
              Upgrade to Business to view audit logs
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Audit logs help you track important changes and keep your
              workspace secure.
            </p>
            {canUpgrade && (
              <Button asChild className={cn(PRIMARY, "mt-1")}>
                <Link href={plansHref}>
                  <Crown className="size-4" aria-hidden />
                  Upgrade to Business
                </Link>
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
