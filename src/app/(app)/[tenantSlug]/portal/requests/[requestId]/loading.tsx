import { Skeleton } from "@/components/ui/skeleton";
import {
  PORTAL_CARD_SHADOW,
  PortalBackLinkSkeleton,
  PortalContentSkeleton,
  PortalMessageSkeleton,
  PortalStateBadgeSkeleton,
} from "@/features/portal/components/portal-skeletons";
import { cn } from "@/lib/utils";

/**
 * Without this file Next.js has no fallback for the async page beside it, so a
 * click leaves the previous screen up until every query has finished — which
 * reads as a dead link and gets clicked again.
 *
 * Mirrors PortalRequestDetailView: bubbles above, one card below. The thread is
 * a conversation -- the customer's messages on the right, the team's on the
 * left -- so the skeleton draws a bubble on each side and no hairline between
 * them, which is what would arrive. The reply form is the one card, and the
 * textarea inside it is a real control, so both keep their outlines. The
 * number and state badges are filled chips, drawn as bars.
 *
 * The CSAT prompt is deliberately absent: the real page only shows it once
 * request.csat.resolvedAt is set, and a skeleton cannot know that. Drawing one
 * would either flash a card that should not be there or, worse, hide the
 * surprise when a satisfied customer lands on the form to rate the fix.
 */

const RULE = "h-px w-full bg-slate-200/80";

const CARD = cn("rounded-2xl border bg-card p-6 sm:p-8", PORTAL_CARD_SHADOW);

/**
 * Two messages, one from each side, so the thread arrives already reading as a
 * conversation. The bubble widths are the real ones' range -- a customer's note
 * tends to run longer than the reply -- and they are what give the bars inside
 * each bubble something to be a percentage of. Without one the bubble collapses
 * to its padding and the message body draws nothing.
 */
const MESSAGES = [
  {
    fromTeam: false,
    lines: ["w-full", "w-3/4"],
    author: "w-32",
    bubble: "w-[72%]",
  },
  {
    fromTeam: true,
    lines: ["w-full", "w-11/12", "w-2/3"],
    author: "w-28",
    bubble: "w-[58%]",
  },
];

export default function Loading() {
  return (
    <PortalContentSkeleton width="max-w-7xl">
      <PortalBackLinkSkeleton />

      <section className="mt-4">
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-start sm:justify-between">
          {/* flex-wrap, like the real row: at a narrow width the two timestamps
              drop under the chips on the page, and a skeleton that cannot wrap
              holds the line open and makes the subject below arrive 8px up. */}
          <div className="flex flex-wrap items-center gap-2">
            {/* h-[26px] w-[52px], both measured. The real chip is a text-xs line
                (16) in py-1 with a border, so 26 tall; the old h-6 w-9 was 4px
                short and 17px narrow, which read as a stub rather than a
                number. The pill beside it is the same box plus the label. */}
            <Skeleton className="h-6.5 w-13 rounded-md bg-slate-200/80" />
            <PortalStateBadgeSkeleton className="h-6.5 w-14" />
          </div>

          {/* h-4, not h-3: the real stamps are text-xs, a 16px line. sm:gap-0.5
              is the real gap, so the pair is 34px here and 34px on the page --
              gap-y-1.5 made it 30 and put the subject 4px high. */}
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 sm:flex-col sm:items-end sm:gap-0.5">
            <Skeleton className="h-4 w-40 bg-slate-200/80" />
            <Skeleton className="h-4 w-42 bg-slate-200/80" />
          </div>
        </div>

        {/* h-8 below sm:, then 2.3333rem above it. The real h1 is text-2xl,
            whose line-height is calc(2/1.5) -- a ratio, not 32px -- and
            sm:text-[1.75rem] raises the size without touching it, so the line
            goes 24*4/3 = 32px on a phone and 28*4/3 = 37.33px on a desktop. A
            flat h-8 is right on one and 5px short on the other, under the
            largest text on the page. */}
        <Skeleton className="mt-3 h-8 w-3/5 bg-slate-300/70 sm:h-[2.3333rem]" />

        <div className={cn(RULE, "mt-6")} />

        <div className="mt-6 flex flex-col">
          {MESSAGES.map((message, index) => (
            <PortalMessageSkeleton
              key={index}
              fromTeam={message.fromTeam}
              lineWidths={message.lines}
              authorWidth={message.author}
              bubbleWidth={message.bubble}
            />
          ))}
        </div>
      </section>

      <section className={cn(CARD, "mt-8")}>
        {/* gap-1.5 and the lock icon, to match the real row: the heading and the
            "only you and the team can see this" note are a tight pair. */}
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <Skeleton className="h-5 w-44 bg-slate-300/70" />
          <div className="flex items-center gap-1.5">
            <Skeleton className="size-3.5 shrink-0 rounded-full bg-slate-200/80" />
            <Skeleton className="h-3 w-60 max-w-full bg-slate-200/80" />
          </div>
        </div>

        {/* A real outlined textarea, not a grey bar: it is a control, and inside
            the card it reads as a field recessed into it. */}
        <div className="mt-3 min-h-28 rounded-xl border bg-background/60" />

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-2">
            {/* h-11 w-32: the real Attach files button, at the size it now is
                in the row with Send. */}
            <div className="h-11 w-32 rounded-lg border bg-card" />
            <Skeleton className="h-3 w-32 bg-slate-200/80" />
          </div>

          <Skeleton className="h-11 w-full rounded-lg bg-slate-300/70 sm:w-36" />
        </div>
      </section>
    </PortalContentSkeleton>
  );
}
