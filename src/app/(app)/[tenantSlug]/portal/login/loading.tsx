import { Skeleton } from "@/components/ui/skeleton";
import {
  PortalFieldSkeleton,
  PortalIconBadgeSkeleton,
  PortalSplitSkeleton,
} from "@/features/portal/components/portal-skeletons";

/**
 * Without this file Next.js has no fallback for the async page beside it, so a
 * signed-in visitor following a stale /portal/login link gets the previous
 * screen up until getPortalIdentity resolves and redirects them away.
 *
 * Mirrors PortalSignInForm in the magic-link mode it opens in: the icon badge,
 * the heading and its lead, then the form's `mt-5 gap-4` stack -- the email
 * field, the h-11 submit button, the divider, and the switch to a password --
 * followed by the FirstTimeNote, which both modes render.
 *
 * The bar heights are the real line boxes, not approximations, and the bar
 * COUNTS are the real wrap: the card is centred, so a skeleton 20px shorter
 * than the form shifts it by 10px when the data lands. Measured at the 382px
 * content column, the lead is two lines and the note body is two. text-2xl is a
 * 32px line (h-8), the leading-[1.6] lead is 22.4px (h-5.5), the field label
 * and the divider's "or" are 20px (h-5), and the note's two leading-5 lines
 * are h-4 bars on a gap-2 -- a 24px pitch against the real 20, but it lands
 * the pair on the real 40px. The switch stays h-4: it is a bare button and
 * measures 16px. Net drift is 1.2px on a 565px card.
 *
 * Password mode swaps the switch for a second field and adds a "Forgot
 * password?" link, so it is a little taller. The skeleton cannot know which
 * mode resolved, and drawing the taller one would push every magic-link sign-in
 * down by a row. Magic-link is the default and by far the common case, so that
 * is what is drawn.
 */
export default function Loading() {
  return (
    <PortalSplitSkeleton>
      <PortalIconBadgeSkeleton />

      <div className="mt-4 flex flex-col gap-1.5">
        <Skeleton className="h-8 w-52 max-w-full bg-slate-300/70" />
        {/* The lead wraps to two lines at 382px, so it is two bars, not one.
            gap-0.5 puts the pair at 46px against the real 44.8. */}
        <div className="flex flex-col gap-0.5">
          <Skeleton className="h-5.5 w-full bg-slate-200/80" />
          <Skeleton className="h-5.5 w-4/5 bg-slate-200/80" />
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-4">
        <PortalFieldSkeleton labelWidth="w-28" />

        <Skeleton className="h-11 w-full rounded-lg bg-slate-300/70 sm:w-fit sm:min-w-48" />

        <div className="flex h-5 items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          <Skeleton className="h-3 w-4 bg-slate-200/80" />
          <span className="h-px flex-1 bg-border" />
        </div>

        {/* h-4, not h-5: the real switch is a bare <button> and measures 16px,
            while the divider above it is a 20px text-xs line. They are not the
            same box even though both hold text. */}
        <Skeleton className="h-4 w-56 max-w-full bg-slate-200/80" />
      </div>

      <div className="mt-6 rounded-xl border bg-muted/40 p-4">
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-7 shrink-0 rounded-lg bg-slate-200/80" />
          <Skeleton className="h-5 w-24 bg-slate-300/70" />
        </div>

        <div className="mt-2.5 flex flex-col gap-2">
          <Skeleton className="h-4 w-full bg-slate-200/80" />
          <Skeleton className="h-4 w-3/4 bg-slate-200/80" />
        </div>
      </div>
    </PortalSplitSkeleton>
  );
}
