import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
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

/** The state pill. */
export function PortalStateBadgeSkeleton() {
  return <Skeleton className="h-6 w-18 rounded-full bg-slate-200/80" />;
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
      <Skeleton className={cn("h-4 bg-slate-200/80", labelWidth)} />
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
 * One message in the thread. Flat, because the thread is: the request detail
 * page stacks the messages with divide-y and gives each one padding and
 * nothing else, so a bubble-shaped skeleton would flash a card the real page
 * never draws. The avatar is the only tone difference left between the two
 * sides, matching the tinted/solid pair on the real messages.
 */
export function PortalMessageSkeleton({
  fromTeam = true,
  lineWidths = ["w-full", "w-11/12", "w-2/3"],
  authorWidth = "w-28",
}: {
  fromTeam?: boolean;
  lineWidths?: string[];
  authorWidth?: string;
}) {
  return (
    <article className="py-5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <PortalRoundIconSkeleton
          className={cn(
            "size-9",
            fromTeam ? "bg-slate-300/70" : "bg-slate-200/80",
          )}
        />
        <div className="flex flex-col gap-1.5">
          <Skeleton className={cn("h-4 bg-slate-300/70", authorWidth)} />
          <Skeleton className="h-3 w-20 bg-slate-200/80" />
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:pl-12">
        {lineWidths.map((width, index) => (
          <Skeleton key={index} className={cn("h-4 bg-slate-200/80", width)} />
        ))}
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
  width: "max-w-3xl" | "max-w-4xl" | "max-w-5xl" | "max-w-6xl";
  children: ReactNode;
}) {
  return <div className={cn("mx-auto w-full", width)}>{children}</div>;
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
  return (
    <div
      className={cn(
        "mx-auto w-full rounded-2xl border bg-card p-5 sm:p-8",
        PORTAL_CARD_SHADOW,
        width,
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Mirrors PortalSplit: the single centred sign-in card.
 */
export function PortalSplitSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md">
      <div
        className={cn(
          "w-full rounded-2xl border bg-card p-5 sm:p-8",
          PORTAL_CARD_SHADOW,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Stands in for the inline SVG illustrations (w-44 sm:w-52 at 220×160): a soft
 * rounded block of the same box, so the heading below does not move.
 */
export function PortalIllustrationSkeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <Skeleton
      className={cn(
        "aspect-11/8 w-44 rounded-3xl bg-slate-200/80 sm:w-52",
        className,
      )}
    />
  );
}
