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
 * the heading and its one-line lead, then the form's `mt-5 gap-4` stack -- the
 * email field, the h-11 submit button, the divider, and the switch to a
 * password -- followed by the FirstTimeNote, which both modes render.
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
        <Skeleton className="h-6 w-52 max-w-full bg-slate-300/70" />
        <Skeleton className="h-5 w-full bg-slate-200/80" />
      </div>

      <div className="mt-5 flex flex-col gap-4">
        <PortalFieldSkeleton labelWidth="w-28" />

        <Skeleton className="h-11 w-full rounded-lg bg-slate-300/70 sm:w-fit sm:min-w-48" />

        <div className="flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          <Skeleton className="h-3 w-4 bg-slate-200/80" />
          <span className="h-px flex-1 bg-border" />
        </div>

        <Skeleton className="h-4 w-56 max-w-full bg-slate-200/80" />
      </div>

      <div className="mt-6 rounded-xl border bg-muted/40 p-4">
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-7 shrink-0 rounded-lg bg-slate-200/80" />
          <Skeleton className="h-5 w-24 bg-slate-300/70" />
        </div>

        <div className="mt-2.5 flex flex-col gap-1.5">
          <Skeleton className="h-3 w-full bg-slate-200/80" />
          <Skeleton className="h-3 w-3/4 bg-slate-200/80" />
        </div>
      </div>
    </PortalSplitSkeleton>
  );
}
