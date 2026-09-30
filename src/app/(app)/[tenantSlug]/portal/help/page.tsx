import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpen,
  ChevronRight,
  CreditCard,
  LifeBuoy,
  Rocket,
  Search,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";
import { getPortalTenant } from "@/features/portal/services/portal.service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Help centre",
};

type Topic = {
  icon: LucideIcon;
  title: string;
  body: string;
  /** Pre-fills the request subject; null opens a blank request. */
  subject: string | null;
  tone: string;
};

/**
 * There is no knowledge-base table yet, so nothing here opens an article.
 * Every topic -- and the search box -- starts a request with the subject
 * already filled in, which is where a customer with that question ends up
 * today anyway. When articles exist, point the cards at them instead.
 */
export default async function PortalHelpPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await getPortalTenant(tenantSlug);
  const productName = tenant?.name ?? "the product";

  const newRequest = portalPath(tenantSlug, PORTAL_ROUTES.NEW_REQUEST);

  const topics: Topic[] = [
    {
      icon: Rocket,
      title: "Getting started",
      body: "Learn the basics and set up your account.",
      subject: "Help getting started",
      tone: "bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-300",
    },
    {
      icon: CreditCard,
      title: "Account & billing",
      body: "Manage your plan, payments and invoices.",
      subject: "Question about my account or billing",
      tone: "bg-teal-50 text-teal-600 dark:bg-teal-950/50 dark:text-teal-300",
    },
    {
      icon: BookOpen,
      title: `Using ${productName}`,
      body: "Guides and best practices.",
      subject: `How do I… (using ${productName})`,
      tone: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300",
    },
    {
      icon: Wrench,
      title: "Troubleshooting",
      body: "Something isn't working as expected.",
      subject: "Something isn't working",
      tone: "bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300",
    },
    {
      icon: ShieldCheck,
      title: "Security",
      body: "Keep your account safe.",
      subject: "Security question",
      tone: "bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300",
    },
    {
      icon: LifeBuoy,
      title: "Contact support",
      body: "Still need help? Submit a request.",
      subject: null,
      tone: "bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Help centre
        </h1>

        <p className="mt-2 text-sm leading-[1.6] text-muted-foreground">
          Tell us what you&apos;re looking for, or pick a topic below, and
          we&apos;ll start a request for you.
        </p>

        {/* A plain GET form: it needs no client code, and lands on the
            request form with the subject filled in. */}
        <form
          action={newRequest}
          method="get"
          role="search"
          className="mt-6 flex items-center gap-2 rounded-xl border bg-card p-1.5 pl-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.05)] focus-within:border-brand-accent/50 focus-within:ring-3 focus-within:ring-brand-accent/15"
        >
          <Search
            aria-hidden
            className="size-4.5 shrink-0 text-muted-foreground"
          />
          <label htmlFor="portal-help-search" className="sr-only">
            What do you need help with?
          </label>
          <input
            id="portal-help-search"
            name="subject"
            type="text"
            required
            maxLength={200}
            autoComplete="off"
            placeholder="What do you need help with?"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" className="h-10 shrink-0 px-4 font-semibold">
            Ask us
          </Button>
        </form>
      </div>

      <h2 className="mt-10 text-sm font-bold text-foreground sm:mt-12">
        Browse by topic
      </h2>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
        {topics.map(({ icon: Icon, title, body, subject, tone }) => (
          <li key={title}>
            <Link
              href={
                subject
                  ? `${newRequest}?subject=${encodeURIComponent(subject)}`
                  : newRequest
              }
              className={cn(
                "group flex h-full items-center gap-4 rounded-xl border bg-card p-4 text-foreground transition-all sm:p-5",
                "hover:-translate-y-0.5 hover:border-brand-accent/40 hover:text-foreground hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)]",
                "focus-visible:ring-2 focus-visible:ring-brand-accent/30 focus-visible:outline-none",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-full",
                  tone,
                )}
              >
                <Icon className="size-5" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{title}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {body}
                </span>
              </span>

              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand-accent"
              />
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Written guides are on their way. Until then, every question goes
        straight to our team.
      </p>
    </div>
  );
}
