import Link from "next/link";
import { Bookmark, Check, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { describeFilter, type ViewFilter } from "../filters";

/**
 * What a free tenant sees at /views.
 *
 * Deliberately not a 404 and not a hidden route: the page is the only place
 * that explains what the feature is, so it has to show the shape of it. The
 * examples below are the real filter model rendered through the same
 * describeFilter() the live cards use, so nothing here can drift from what a
 * paid tenant actually gets.
 */
const EXAMPLES: { name: string; filter: ViewFilter }[] = [
  {
    name: "My tickets",
    filter: {
      statuses: ["new", "open", "pending"],
      priorities: [],
      assignee: "me",
      search: "",
    },
  },
  {
    name: "My resolved",
    filter: {
      statuses: ["resolved"],
      priorities: [],
      assignee: "me",
      search: "",
    },
  },
  {
    name: "Urgent tickets",
    filter: {
      statuses: ["new", "open", "pending"],
      priorities: ["urgent"],
      assignee: "any",
      search: "",
    },
  },
  {
    name: "Payment issues",
    filter: {
      statuses: [],
      priorities: [],
      assignee: "any",
      search: "payment",
    },
  },
];

const INCLUDED = [
  "Filter by any combination of status, priority and assignee",
  "Save a text search as a reusable view",
  "Share a view with the whole team, or keep it to yourself",
  "See a live ticket count on every view",
];

export function SavedViewsUpsell({ tenantSlug }: { tenantSlug: string }) {
  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
              Saved views
            </h1>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-slate-600">
              PRO
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Your own filters over the ticket queue, saved and shareable.
          </p>
        </div>

        <Button
          asChild
          className="h-9 px-4 text-xs font-bold bg-[#0d7a6a] hover:bg-[#095b4f] text-white rounded-lg shadow-none"
        >
          <Link href={`/${tenantSlug}/account/plans`}>Upgrade to Pro</Link>
        </Button>
      </div>

      <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <p className="text-sm font-bold text-slate-900">
          You already have the built-in views
        </p>
        <p className="mt-1 text-sm text-slate-500">
          All open, New, Open and Resolved are on the ticket queue for every
          plan, and always will be.{" "}
          <Link
            href={`/${tenantSlug}/tickets`}
            className="font-semibold text-teal-800 hover:text-teal-900"
          >
            Go to the queue
          </Link>
          .
        </p>
      </div>

      <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3.5">
          <p className="text-sm font-bold text-slate-900">
            What you could build
          </p>
        </div>

        <div className="divide-y divide-slate-100">
          {EXAMPLES.map((example) => (
            <div
              key={example.name}
              className="flex items-center justify-between gap-4 px-5 py-4"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Bookmark className="h-4 w-4 shrink-0 text-slate-300" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-400">
                    {example.name}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-400">
                    {describeFilter(example.filter)}
                  </p>
                </div>
              </div>

              <Lock className="h-3.5 w-3.5 shrink-0 text-slate-300" />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <p className="text-sm font-bold text-slate-900">Included with Pro</p>
        <ul className="mt-3 space-y-2">
          {INCLUDED.map((line) => (
            <li
              key={line}
              className="flex items-start gap-2 text-sm text-slate-600"
            >
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700" />
              {line}
            </li>
          ))}
        </ul>

        <Button
          asChild
          className="mt-4 h-9 px-4 text-xs font-bold bg-[#0d7a6a] hover:bg-[#095b4f] text-white rounded-lg shadow-none"
        >
          <Link href={`/${tenantSlug}/account/plans`}>See plans</Link>
        </Button>
      </div>
    </div>
  );
}
