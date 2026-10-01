import { Skeleton } from "@/components/ui/skeleton";
import { PortalCentered } from "@/features/portal/components/portal-shell";
import {
  PortalButtonPairSkeleton,
  PortalCardSkeleton,
  PortalFieldSkeleton,
  PortalRoundIconSkeleton,
} from "@/features/portal/components/portal-skeletons";

/**
 * Without this file Next.js has no fallback for the async page beside it.
 *
 * Mirrors PortalSetPasswordForm: the green "Signed in" banner, the heading, the
 * password field, the confirm field, the button pair, and the note under the
 * rule. There is no requirements box because the form has none -- see
 * PortalPasswordFields. The banner keeps its green because it is the only thing
 * on the card that says the sign-in already succeeded -- a grey block there
 * reads as having been sent back to the login screen.
 */
export default function Loading() {
  // PortalCentered rather than PortalCardSkeleton on its own, matching the page:
  // a skeleton that hangs under the header and then jumps to the middle when
  // the card lands is the shift a loading state must never make.
  return (
    <PortalCentered width="max-w-120">
      <PortalCardSkeleton>
        <div className="flex items-start gap-3 rounded-xl border border-success/20 bg-success-soft px-4 py-3">
          <PortalRoundIconSkeleton className="size-5 bg-success/20" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-16 bg-success/20" />
            <Skeleton className="h-3 w-52 max-w-full bg-success/15" />
          </div>
        </div>

        <Skeleton className="mt-6 h-6 w-48 bg-slate-300/70" />
        <div className="mt-1.5 flex flex-col gap-1.5">
          <Skeleton className="h-4 w-full bg-slate-200/80" />
          <Skeleton className="h-4 w-3/5 bg-slate-200/80" />
        </div>

        <div className="mt-5 flex flex-col gap-4">
          <PortalFieldSkeleton labelWidth="w-20" />

          <PortalFieldSkeleton labelWidth="w-36" />

          <PortalButtonPairSkeleton
            widths={["sm:w-32", "sm:w-36"]}
            className="mt-2 sm:justify-end"
          />
        </div>

        <div className="mt-6 flex flex-col gap-1.5 border-t pt-4">
          <Skeleton className="h-3 w-full bg-slate-200/80" />
          <Skeleton className="h-3 w-1/2 bg-slate-200/80" />
        </div>
      </PortalCardSkeleton>
    </PortalCentered>
  );
}
