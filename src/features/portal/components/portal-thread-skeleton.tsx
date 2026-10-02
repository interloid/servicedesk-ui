"use client";

import { useParams } from "next/navigation";

import { PortalMessageSkeleton } from "@/features/portal/components/portal-skeletons";
import { threadHasTeamReply } from "@/features/portal/thread-hint";

/**
 * The thread part of the request page's loading skeleton.
 *
 * Always the customer's opening message, at the top where the real thread
 * starts: every request has one. A team reply is drawn under it only when the
 * requests list said there is one -- the row that was clicked left that hint
 * on its way out. Opened any other way (a reload, a pasted link) there is no
 * hint, and the skeleton promises nothing it cannot know.
 */
export function PortalThreadSkeleton() {
  const { requestId } = useParams<{ requestId?: string }>();
  const hasTeamReply = requestId ? threadHasTeamReply(requestId) : undefined;

  return (
    <>
      <PortalMessageSkeleton
        fromTeam={false}
        lineWidths={["w-full", "w-3/4"]}
        authorWidth="w-32"
        bubbleWidth="w-[72%]"
      />

      {hasTeamReply ? (
        <PortalMessageSkeleton
          fromTeam
          lineWidths={["w-full", "w-11/12", "w-2/3"]}
          authorWidth="w-28"
          bubbleWidth="w-[58%]"
        />
      ) : null}
    </>
  );
}
