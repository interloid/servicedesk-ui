import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { PortalCard } from "@/features/portal/components/portal-shell";
import { PortalSplit } from "@/features/portal/components/portal-split";
import { cn } from "@/lib/utils";

/**
 * Shapes shared by the portal's loading.tsx files.
 *
 * The rule the portal's skeletons follow is the one already used by
 * settings/team/loading.tsx: mirror the real page at every breakpoint — same
 * container width, same wrapping, same control heights — so the content does
 * not jump sideways when the data lands. Every width here is taken from the
 * component it stands in for, not invented, which is why the constants below
 * look arbitrary: they are the class names the real markup already uses.
 *
 * Two tones: bg-slate-300/70 for the large blocks that read as headings,
 * bg-slate-200/80 for the small bars and pills. One step darker than
 * billing/reuse.tsx, because the portal page is slate-50 and slate-100 bars
 * all but vanish on it. Widths
 * within a repeated row are varied on purpose — four identical rows read as one
 * grey block rather than as four things loading.
 *
 * Cards, borders and dashed dropzones are drawn as the real bordered boxes,
 * not as grey blocks, so nothing changes colour or outline when the page lands.
 */

/** The shadow every portal card uses. Kept in step with the real cards. */
export const PORTAL_CARD_SHADOW =
  "shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.06)]";

/** "Your requests" / back link above the list, form and detail pages. */
export function PortalBackLinkSkeleton() {
  return (
    <div className="flex items-center gap-1.5">
      <Skeleton className="size-4 rounded bg-slate-200/80" />
      <Skeleton className="h-4 w-24 bg-slate-200/80" />
    </div>
  );
}

/**
 * The state pill. `className` carries the position when the page pins the badge
 * to a corner -- the requests list takes it out of the flow, and a skeleton left
 * in the flow would sit 57px inside the edge and then jump on landing.
 *
 * h-6 is the unbordered pill, which is what the list draws: a 16px text-xs line
 * in py-1. The request detail draws the same pill WITH a border, so it measures
 * 26px and its callers pass h-[26px] -- two pixels, but on a 26px box next to a
 * matching number chip it is the difference between the pair landing together
 * and the pill sitting a notch low.
 */
export function PortalStateBadgeSkeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <Skeleton
      className={cn("h-6 w-18 rounded-full bg-slate-200/80", className)}
    />
  );
}

/** A page heading and the line or two of copy under it. */
export function PortalHeadingSkeleton({
  titleWidth = "w-56",
  lines = ["w-full sm:w-120"],
  centred = false,
}: {
  titleWidth?: string;
  lines?: string[];
  centred?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-2.5", centred && "items-center")}>
      <Skeleton className={cn("h-8 max-w-full bg-slate-300/70", titleWidth)} />
      <div
        className={cn(
          "flex w-full flex-col gap-1.5",
          centred && "items-center",
        )}
      >
        {lines.map((width, index) => (
          <Skeleton
            key={index}
            className={cn("h-4 max-w-full bg-slate-200/80", width)}
          />
        ))}
      </div>
    </div>
  );
}

/** The tinted square icon above a sign-in card's heading. */
export function PortalIconBadgeSkeleton() {
  return <Skeleton className="size-11 rounded-xl bg-slate-200/80" />;
}

/** A round icon, as used in the feature, topic and step lists. */
export function PortalRoundIconSkeleton({
  className = "size-11",
}: {
  className?: string;
}) {
  return (
    <Skeleton
      className={cn("shrink-0 rounded-full bg-slate-200/80", className)}
    />
  );
}

/**
 * A labelled control. `control` is the real control's height class rather than
 * a number, so a caller cannot drift from the form it is standing in for: the
 * portal inputs are h-11 and the new-request description is a taller box.
 *
 * The label bar is h-5, not h-4, because every FormLabel in the portal is
 * text-sm and a 20px line box. The cards that centre themselves (sign-in,
 * check-email) move both edges when a shorter skeleton is swapped for the real
 * form, so a 4px miss here is an 8px jump in the middle of the viewport.
 */
export function PortalFieldSkeleton({
  labelWidth = "w-24",
  control = "h-11",
  description,
}: {
  labelWidth?: string;
  control?: string;
  /** Width of the helper line under the control, when the real field has one. */
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className={cn("h-5 bg-slate-200/80", labelWidth)} />
      {/* A real bordered input, not a grey bar: the field outline is what the
          eye lands on, and it should already be where it will be. */}
      <div
        className={cn("w-full rounded-lg border bg-background/60", control)}
      />
      {description ? (
        <Skeleton
          className={cn("h-3 max-w-full bg-slate-200/80", description)}
        />
      ) : null}
    </div>
  );
}

/** A pair of buttons, full width in a 2-column grid on a phone. */
export function PortalButtonPairSkeleton({
  widths = ["sm:w-28", "sm:w-36"],
  className,
}: {
  widths?: [string, string];
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-2.5 sm:flex", className)}>
      <div className={cn("h-11 rounded-lg border bg-card", widths[0])} />
      <Skeleton className={cn("h-11 rounded-lg bg-slate-300/70", widths[1])} />
    </div>
  );
}

/**
 * One message in the thread. A bubble, aligned to the side that wrote it, with
 * the author row above it exactly as the real message has it. The avatar is the
 * only tone difference between the two sides, matching the solid/tinted pair on
 * the real messages.
 *
 * bubbleWidth is not decoration. The article is a column flex with items-start,
 * so the bubble shrink-wraps: the real one gets its width from its text, and a
 * skeleton has none. Left to size itself, the bubble collapsed to its own 28px
 * of padding and the w-full bars inside it resolved against nothing and drew
 * nothing at all -- the message body was invisible and only the avatar and the
 * name bar showed. A definite width on the bubble is what gives those bars
 * something to be a percentage of.
 */
export function PortalMessageSkeleton({
  fromTeam = true,
  lineWidths = ["w-full", "w-11/12", "w-2/3"],
  authorWidth = "w-28",
  bubbleWidth = "w-[64%]",
}: {
  fromTeam?: boolean;
  lineWidths?: string[];
  authorWidth?: string;
  bubbleWidth?: string;
}) {
  return (
    <article
      className={cn(
        "flex min-w-0 flex-col gap-2 py-4 first:pt-0 last:pb-0",
        fromTeam ? "items-start" : "items-end",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2.5",
          !fromTeam && "flex-row-reverse",
        )}
      >
        {/* The page's avatars: solid brand for the team, a ringed tint
            for the customer. */}
        <PortalRoundIconSkeleton
          className={cn(
            "size-8",
            fromTeam
              ? "bg-brand-accent/25"
              : "bg-brand-accent/10 ring-1 ring-brand-accent/25 ring-inset",
          )}
        />
        <div
          className={cn(
            "flex min-w-0 flex-col gap-0.5",
            !fromTeam && "items-end",
          )}
        >
          {/* h-5 and h-3.5 on a 2px gap, which is 36px: the real column is a
              text-sm name (20) directly above a text-xs stamp (16) with no gap
              of its own. The bars used to be 16 and 12 on a 6px gap, so the
              header came out 2px short and every bubble below it sat 2px high. */}
          <div
            className={cn(
              "flex items-center gap-2",
              !fromTeam && "flex-row-reverse",
            )}
          >
            <Skeleton className={cn("h-5 bg-slate-300/70", authorWidth)} />
            {/* The "Support team" pill beside an agent's name. */}
            {fromTeam ? (
              <Skeleton className="h-5 w-20 rounded-full bg-brand-accent/10" />
            ) : null}
          </div>
          <Skeleton className="h-3.5 w-20 bg-slate-200/80" />
        </div>
      </div>

      <div
        className={cn(
          "min-w-0 max-w-[85%] rounded-2xl px-3.5 py-2.5 sm:max-w-[75%]",
          bubbleWidth,
          // The page's bubble colours, so the bars read as text inside a
          // message rather than grey on grey.
          fromTeam
            ? "rounded-tl-sm bg-muted"
            : "rounded-tr-sm bg-brand-accent/10",
        )}
      >
        {/* h-5.5 bars on a gap-2.5. The real bubble is text-sm leading-[1.6],
            which is 14px * 1.6 = 22.4px a line, with mt-2.5 (10px) between
            paragraphs. At h-4/gap-2 a two-paragraph message drew 62px where the
            page draws 74, and a three-paragraph one 90 where the page draws
            107 -- the thread came in a third shorter than the skeleton and
            every message below it jumped. */}
        <div className="flex flex-col gap-2.5">
          {lineWidths.map((width, index) => (
            <Skeleton
              key={index}
              className={cn("h-5.5 bg-slate-300/60", width)}
            />
          ))}
        </div>
      </div>
    </article>
  );
}

/**
 * The page column. Each page names its own width so a loading file cannot
 * draw a different column from the page that replaces it.
 */
export function PortalContentSkeleton({
  width,
  children,
}: {
  width: "max-w-3xl" | "max-w-4xl" | "max-w-5xl" | "max-w-6xl" | "max-w-7xl";
  children: ReactNode;
}) {
  return <div className={cn("mx-auto w-full md:px-6", width)}>{children}</div>;
}

/**
 * A plain card. Matches PortalCard (max-w-120) by default; the welcome wizard
 * brings its own wider max-w-180 box, and the requests pages use it at full
 * column width.
 */
export function PortalCardSkeleton({
  width = "max-w-120",
  className,
  children,
}: {
  width?: "max-w-120" | "max-w-180" | "max-w-none";
  className?: string;
  children: ReactNode;
}) {
  // PortalCard itself, not a second copy of its markup. It takes the width
  // through className and cn merges it over the default, so this stays a
  // one-line delegation. Two hand-rolled twins of one wrapper is how the
  // sign-in card came to sit 4px off its skeleton, and how the portal ended up
  // with four near-identical versions of the same box.
  return <PortalCard className={cn(width, className)}>{children}</PortalCard>;
}

/**
 * Mirrors PortalSplit: the single centred sign-in card.
 */
export function PortalSplitSkeleton({ children }: { children: ReactNode }) {
  // The real component rather than a copy of its markup. A skeleton that
  // centres itself by its own rule puts the card somewhere else when the data
  // lands, which is the one thing a loading state must never do -- and these
  // two were already a copy pair, which is how the request-list skeleton came
  // to sit 4px off its card.
  return <PortalSplit>{children}</PortalSplit>;
}
