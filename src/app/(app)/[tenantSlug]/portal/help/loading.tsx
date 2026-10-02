import { Skeleton } from "@/components/ui/skeleton";
import {
  PortalContentSkeleton,
  PortalHeadingSkeleton,
  PortalRoundIconSkeleton,
} from "@/features/portal/components/portal-skeletons";

/**
 * The page awaits the tenant (for "Using <tenant>"), and without a fallback the
 * Help centre link in the header looks dead until it resolves.
 *
 * Mirrors the help page at its resting state: the centred heading and copy, the
 * max-w-2xl search bar, "Browse by topic", the six topic cards in their
 * 1 / 2 / 3-column grid, and the closing line under them. Searching filters
 * those same six cards, so nothing about the skeleton changes once the box has
 * text in it -- and the "no topic matched" card cannot appear here, because
 * that state needs a typed query.
 *
 * The search bar is inside its own max-w-2xl, not the page column's max-w-7xl:
 * a skeleton that stretched it full width put a 200px-long bar where a 672px one
 * lands.
 */

const TOPICS = [
  { title: "w-28", body: "w-4/5" },
  { title: "w-32", body: "w-3/4" },
  { title: "w-28", body: "w-2/3" },
  { title: "w-32", body: "w-4/5" },
  { title: "w-20", body: "w-1/2" },
  { title: "w-32", body: "w-3/4" },
];

export default function Loading() {
  return (
    <PortalContentSkeleton width="max-w-7xl">
      <div className="mx-auto max-w-2xl text-center">
        {/* One line of copy at every width, so the second bar is the phone's
            wrap of the same sentence and nothing sits a line lower on
            arrival. */}
        <PortalHeadingSkeleton
          centred
          titleWidth="w-44"
          lines={["w-96", "w-56 sm:hidden"]}
        />

        <div className="mx-auto mt-6 flex max-w-2xl items-center gap-2 rounded-xl border bg-card p-1.5 pl-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.05)]">
          <Skeleton className="size-4.5 shrink-0 rounded-full bg-slate-200/80" />
          <Skeleton className="h-4 flex-1 bg-slate-200/80 sm:max-w-56" />
          {/* The clear button only exists once there is something to clear. */}
          <Skeleton className="ml-auto h-10 w-20 rounded-lg bg-slate-300/70" />
        </div>
      </div>

      <Skeleton className="mt-10 h-4 w-32 bg-slate-300/70 sm:mt-12" />

      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
        {TOPICS.map((topic, index) => (
          <li
            key={index}
            className="flex items-center gap-4 rounded-xl border bg-card p-4 sm:p-5"
          >
            <PortalRoundIconSkeleton />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className={`h-4 ${topic.title} bg-slate-300/70`} />
              <Skeleton className={`h-3 ${topic.body} bg-slate-200/80`} />
            </div>
            <Skeleton className="size-4 shrink-0 rounded bg-slate-200/80" />
          </li>
        ))}
      </ul>

      {/* The real page closes with this line, and it is the one bit of copy
          that explains what the page is not yet able to do. */}
      <Skeleton className="mx-auto mt-8 h-3 w-4/5 max-w-full bg-slate-200/80 sm:w-96" />
    </PortalContentSkeleton>
  );
}
