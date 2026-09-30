"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Star } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  addCsatCommentAction,
  submitCsatAction,
} from "@/features/portal/actions/portal.actions";
import { CSAT_SCORES, type PortalCsat } from "@/features/portal/portal";
import {
  portalToastResult,
  portalToastSuccess,
} from "@/features/portal/portal-toast";
import { cn } from "@/lib/utils";

const SCORE_LABEL: Record<number, string> = {
  1: "Poor",
  2: "Not great",
  3: "Okay",
  4: "Good",
  5: "Excellent",
};

/**
 * What to say back, by band rather than by star.
 *
 * A rating is the one portal action where the button and the message disagree:
 * somebody who taps one star is telling us we got it wrong, and confirming that
 * with "thanks — poor logged" is both bad English and a small insult. Low scores
 * get an apology, high ones credit the fix. "Okay" gets neither, because
 * "sorry it missed the mark" over-apologises for a neutral answer and "glad that
 * helped" claims a result they did not report.
 */
function ratingAcknowledgement(score: number): string {
  if (score <= 2) {
    return "Sorry we didn't get this right. Your rating goes to the team.";
  }

  if (score === 3) {
    return "Thanks for the rating.";
  }

  return "Glad we could help. Thanks for rating this.";
}

/**
 * Shown only while a rating is owed for the CURRENT resolution, and swapped for
 * a thank-you once given. A reopened request that is resolved again gets a new
 * resolved_at, so the prompt returns on its own — there is no "dismissed" state
 * to track.
 */
export function PortalCsatCard({
  tenantSlug,
  requestId,
  csat,
}: {
  tenantSlug: string;
  requestId: string;
  csat: PortalCsat;
}) {
  const router = useRouter();

  const [hovered, setHovered] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [commentSaved, setCommentSaved] = useState(false);

  const score = csat.score ?? pending;

  async function rate(value: number) {
    if (pending !== null || csat.score !== null) {
      return;
    }

    setError(undefined);
    // Optimistic: the copy promises "one tap", so the stars must fill at once
    // rather than after a round trip.
    setPending(value);

    const result = await submitCsatAction(tenantSlug, requestId, {
      score: value,
      comment: "",
    });

    if (result.success) {
      // The heading turns to a thank-you with the refresh, but the stars
      // emptying on a failure is silent -- so both directions are toasted.
      portalToastSuccess(ratingAcknowledgement(value));
      router.refresh();
      return;
    }

    setPending(null);
    setError(result.message);
    portalToastResult(result);
  }

  async function saveComment() {
    if (!comment.trim() || isSavingComment) {
      return;
    }

    setError(undefined);
    setIsSavingComment(true);

    const result = await addCsatCommentAction(tenantSlug, requestId, comment);

    setIsSavingComment(false);

    if (result.success) {
      setCommentSaved(true);
      // Says what the words are for, which is the only reason to write them.
      portalToastSuccess("Comment added — the team reads it with your rating.");
      router.refresh();
      return;
    }

    setError(result.message);
    portalToastResult(result);
  }

  const rated = score !== null;

  return (
    // No box: on a flat request page this sits under a rule like everything
    // else, and a 2px brand border here was the only thing on the screen
    // shouting. The stars are controls and keep their own outlines.
    <section>
      <h2 className="text-base font-bold text-foreground">
        {rated ? "Thanks — that's logged" : "How did we do?"}
      </h2>

      <p className="mt-1 text-sm leading-[1.55] text-muted-foreground">
        {rated
          ? "The engineer who handled this will see it."
          : "One tap. It goes straight to the engineer who handled this."}
      </p>

      {error ? (
        <Alert
          variant="destructive"
          className="mt-3.5 rounded-[10px] px-3.5 py-3"
        >
          <CircleAlert className="size-4.5" aria-hidden />
          <AlertDescription className="text-sm leading-[1.55]">
            {error}
          </AlertDescription>
        </Alert>
      ) : null}

      <div
        className="mt-4 flex flex-wrap items-center gap-1.5 sm:gap-2.5"
        role="radiogroup"
        aria-label="Rate the support you received"
        onMouseLeave={() => setHovered(null)}
      >
        {CSAT_SCORES.map((value) => {
          const filled = (hovered ?? score ?? 0) >= value;

          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={score === value}
              aria-label={`${value} out of 5 — ${SCORE_LABEL[value]}`}
              title={SCORE_LABEL[value]}
              disabled={rated}
              onMouseEnter={() => !rated && setHovered(value)}
              onFocus={() => !rated && setHovered(value)}
              onClick={() => void rate(value)}
              className={cn(
                "flex size-10 items-center justify-center rounded-lg border transition-colors sm:size-11",
                "focus-visible:ring-2 focus-visible:ring-(--brand-accent)/30 focus-visible:outline-none",
                rated ? "cursor-default" : "hover:border-(--brand-accent)/50",
                filled
                  ? "border-(--brand-accent)/40 bg-brand-badge"
                  : "bg-background",
              )}
            >
              <Star
                aria-hidden
                className={cn(
                  "size-5",
                  filled
                    ? "fill-brand-accent text-brand-accent"
                    : "text-muted-foreground",
                )}
              />
            </button>
          );
        })}

        {rated ? (
          <span className="ml-1 text-sm font-bold text-brand-ink">
            {SCORE_LABEL[score]}
          </span>
        ) : null}
      </div>

      {/* The comment is a second, optional step. Asking for it up front would
          make a one-tap rating feel like a form and cost most of the responses. */}
      {rated && !csat.comment && !commentSaved ? (
        <div className="mt-4 flex flex-col gap-2.5">
          <Textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={isSavingComment}
            rows={3}
            placeholder="Anything you'd like to add? (optional)"
            className="resize-y rounded-lg text-sm"
          />

          <Button
            type="button"
            variant="outline"
            className="w-fit font-bold"
            onClick={() => void saveComment()}
            disabled={isSavingComment || !comment.trim()}
          >
            {isSavingComment ? "Sending…" : "Send comment"}
          </Button>
        </div>
      ) : null}

      {csat.comment || commentSaved ? (
        // A left rule, not a box: it marks the customer's own words as
        // something they wrote after rating, without wrapping them in
        // chrome the thread no longer uses.
        <p className="mt-3.5 border-l-2 border-border pl-3 text-sm leading-[1.55] text-muted-foreground">
          {csat.comment || comment}
        </p>
      ) : null}
    </section>
  );
}
