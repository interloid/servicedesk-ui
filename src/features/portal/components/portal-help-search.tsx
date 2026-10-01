"use client";

import { useState, type FormEvent } from "react";
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
  X,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Topic = {
  icon: LucideIcon;
  title: string;
  body: string;
  /** Pre-fills the request subject; null opens a blank request. */
  subject: string | null;
  /** Extra words the search box matches on, so "invoice" finds billing. */
  keywords: string;
  tone: string;
};

const CARD =
  "group flex h-full w-full items-center gap-4 rounded-xl border bg-card p-4 text-foreground transition-all sm:p-5 hover:-translate-y-0.5 hover:border-brand-accent/40 hover:text-foreground hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)] focus-visible:ring-2 focus-visible:ring-brand-accent/30 focus-visible:outline-none";

/**
 * The help centre's search box and topic list.
 *
 * There is no knowledge-base table yet, so no topic opens an article. Searching
 * filters the topics that do exist and never navigates by itself: the old
 * behaviour typed into the box, hit enter, and landed on the request form with
 * the words in the subject -- which told a customer who had not decided they
 * wanted a ticket that they had just raised one. Creating the request is now
 * something the customer does on purpose, either by clicking a topic or by
 * taking the fallback when the search finds nothing.
 *
 * When articles exist, the fallback below is what gets replaced: filter
 * articles instead of topics, and keep the card for "no article matched".
 */
export function PortalHelpSearch({
  productName,
  newRequest,
}: {
  /** The tenant's name, so a topic can say "Using <product>". */
  productName: string;
  /** Path of the request form, built on the server. */
  newRequest: string;
}) {
  const [query, setQuery] = useState("");

  const trimmed = query.trim();
  const isSearching = trimmed.length > 0;
  const topics = helpTopics(productName);
  const matches = isSearching
    ? topics.filter((topic) => topicMatches(topic, trimmed))
    : topics;
  const nothingFound = isSearching && matches.length === 0;

  /**
   * The form is a plain GET to the request form, so it still works with no
   * JavaScript -- but only as the fallback. Filtering is live, so there is
   * nothing for a submit button to do while there are results, and a button
   * that does nothing is worse than no button: it is drawn only once the
   * search has come up empty, where pressing it is the "ask our team about
   * this" the fallback card has been promising.
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!nothingFound) event.preventDefault();
  }

  const status = !isSearching
    ? ""
    : nothingFound
      ? `No topic matches ${trimmed}. Create a request instead.`
      : `${matches.length} topic${matches.length === 1 ? "" : "s"} match ${trimmed}.`;

  return (
    <form
      action={newRequest}
      method="get"
      role="search"
      onSubmit={handleSubmit}
    >
      {/* The Input primitive's focus treatment (input.tsx), on the wrapper
          rather than the input inside it: the bar, not the bare input, is the
          box that gets drawn, and only the input can take focus, so
          focus-visible here would never match. focus-within is the same
          intent -- the field is focused -- and unlike focus it also covers
          clicking the padding. */}
      <div className="mx-auto mt-6 flex max-w-2xl items-center gap-2 rounded-xl border bg-card p-1.5 pl-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.05)] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 focus-within:outline-none">
        <Search
          aria-hidden
          className="size-4.5 shrink-0 text-muted-foreground"
        />
        <label htmlFor="portal-help-search" className="sr-only">
          Search help topics
        </label>
        <input
          id="portal-help-search"
          name="subject"
          type="search"
          value={query}
          maxLength={200}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="What do you need help with?"
          className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {/* The cross is bare, same as the show/hide eye on the password inputs:
            the ghost variant fills a box on hover, and inside this bar that
            reads as a second field sitting next to the search box. The hover
            affordance is the icon darkening instead. */}
        {isSearching ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setQuery("")}
            className="border-0 bg-transparent hover:bg-transparent hover:text-foreground"
          >
            <X aria-hidden />
            <span className="sr-only">Clear search</span>
          </Button>
        ) : null}
        {/* Nothing to submit while the list is filtering itself. */}
        {nothingFound ? (
          <Button type="submit" className="h-10 shrink-0 px-4 font-semibold">
            Ask us
          </Button>
        ) : null}
      </div>

      {/* Filtering happens as you type, so the count is the only thing that
          needs announcing. */}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {nothingFound ? (
        <div className="mt-8 rounded-xl border border-dashed bg-card px-6 py-10 text-center sm:mt-12">
          <span
            aria-hidden
            className="mx-auto flex size-11 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300"
          >
            <LifeBuoy className="size-5" />
          </span>

          <h2 className="mt-4 text-sm font-semibold">
            Nothing here covers &ldquo;{trimmed}&rdquo;
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-muted-foreground">
            Written guides are still on the way. Send the question to our team
            and you&apos;ll get a reply on the request.
          </p>

          {/* Submits the form above, so the request opens with what the
              customer just typed already in the subject. */}
          <Button type="submit" className="mt-5 h-9 px-4 font-semibold">
            Create a request
          </Button>
        </div>
      ) : (
        <>
          <h2 className="mt-10 text-sm font-bold text-foreground sm:mt-12">
            Browse by topic
          </h2>

          {isSearching ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {matches.length} topic{matches.length === 1 ? "" : "s"} matching
              &ldquo;{trimmed}&rdquo;
            </p>
          ) : null}

          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            {matches.map(({ icon: Icon, title, body, subject, tone }) => (
              <li key={title}>
                <Link
                  href={
                    subject
                      ? `${newRequest}?subject=${encodeURIComponent(subject)}`
                      : newRequest
                  }
                  className={CARD}
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
        </>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Written guides are on their way. Until then, every question goes
        straight to our team.
      </p>
    </form>
  );
}

function helpTopics(productName: string): Topic[] {
  return [
    {
      icon: Rocket,
      title: "Getting started",
      body: "Learn the basics and set up your account.",
      subject: "Help getting started",
      keywords:
        "new account setup sign up signup onboarding first steps start profile how do i begin",
      tone: "bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-300",
    },
    {
      icon: CreditCard,
      title: "Account & billing",
      body: "Manage your plan, payments and invoices.",
      subject: "Question about my account or billing",
      keywords:
        "invoice payment payments plan plans subscription subscribe billing charge charged card credit card receipt refund price pricing upgrade downgrade cancel",
      tone: "bg-teal-50 text-teal-600 dark:bg-teal-950/50 dark:text-teal-300",
    },
    {
      icon: BookOpen,
      title: `Using ${productName}`,
      body: "Guides and best practices.",
      subject: `How do I… (using ${productName})`,
      keywords:
        "how do i how to guide guides feature features workflow workflows best practice practices settings options configuration dashboard report reports",
      tone: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300",
    },
    {
      icon: Wrench,
      title: "Troubleshooting",
      body: "Something isn't working as expected.",
      subject: "Something isn't working",
      keywords:
        "error errors broken bug crash crashed failed failing failure issue issue problem stuck blank loading slow doesn't work not working cannot can't won't freeze frozen",
      tone: "bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300",
    },
    {
      icon: ShieldCheck,
      title: "Security",
      body: "Keep your account safe.",
      subject: "Security question",
      keywords:
        "password passwords login log in signin access locked out hack hacked compromised suspicious privacy permissions permission two factor 2fa mfa",
      tone: "bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300",
    },
    {
      icon: LifeBuoy,
      title: "Contact support",
      body: "Still need help? Submit a request.",
      subject: null,
      keywords:
        "contact support help team agent human person someone talk message question ask speak",
      tone: "bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300",
    },
  ];
}

/**
 * Every word the customer typed has to appear somewhere on the topic, so
 * "invoice" and "billing" narrow the list while "invoice billing" still finds
 * the one card that covers both.
 */
function topicMatches(topic: Topic, query: string): boolean {
  const haystack = [topic.title, topic.body, topic.keywords]
    .join(" ")
    .toLowerCase();

  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}
