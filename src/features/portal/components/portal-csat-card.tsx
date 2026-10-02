"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2, Star } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitCsatAction } from "@/features/portal/actions/portal.actions";
import { CSAT_SCORES, type PortalCsat } from "@/features/portal/portal";
import { portalToastSuccess } from "@/features/portal/portal-toast";
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
 *
 * Picking a star only selects it. Nothing is sent until Submit, so a customer
 * who taps three and then thinks better of it can move to five: a rating that
 * landed on the first tap could not be taken back, and a mis-tap on a phone
 * became the team's score.
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
  const [selected, setSelected] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const rated = csat.score !== null;
  const score = csat.score ?? selected;

  async function submit() {
    if (selected === null || rated || isSubmitting) {
      return;
    }

    setError(undefined);
    setIsSubmitting(true);

    const result = await submitCsatAction(tenantSlug, requestId, {
      score: selected,
      comment,
    });

    setIsSubmitting(false);

    if (result.success) {
      // The card turns to a thank-you with the refresh; the toast says what
      // the score means to us, by band.
      portalToastSuccess(ratingAcknowledgement(selected));
      router.refresh();
      return;
    }

    setError(result.message);
  }

  return (
    // Its own card, set into the thread: it sits among the message bubbles at
    // the end of the conversation, and without an edge it read as one more
    // message rather than as the one thing on the page asking for an answer.
    // A hairline and a faint brand wash rather than a 2px brand border, which
    // was the only thing on the screen shouting.
    <section className="rounded-2xl border bg-linear-to-b from-brand-accent/5 to-card p-4 text-center shadow-xs sm:p-6">
      <h2 className="text-base font-bold text-foreground">
        {rated ? "Thanks - that's logged" : "How did we do?"}
      </h2>

      <p className="mt-1 text-sm leading-[1.55] text-muted-foreground">
        {rated
          ? "The engineer who handled this will see it."
          : "Pick a rating, then submit. It goes straight to the engineer who handled this."}
      </p>

      {error ? (
        <Alert
          variant="destructive"
          className="mt-3.5 rounded-[10px] px-3.5 py-3 text-left"
        >
          <CircleAlert className="size-4.5" aria-hidden />
          <AlertDescription className="text-sm leading-[1.55]">
            {error}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Five equal columns that share the width, so the row never wraps a
          star onto a line of its own on a phone and never spreads past a
          comfortable reach on a desktop. Each star carries its own label, so
          the scale reads before anything is tapped. */}
      <div
        className="mx-auto mt-4 grid w-full max-w-md grid-cols-5 gap-1 sm:gap-2.5"
        role="radiogroup"
        aria-label="Rate the support you received"
        onMouseLeave={() => setHovered(null)}
      >
        {CSAT_SCORES.map((value) => {
          const shown = hovered ?? score ?? 0;
          const filled = shown >= value;
          // The one tile the stars currently stop at: its label is the answer.
          const current = shown === value;
          const locked = rated || isSubmitting;

          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={score === value}
              aria-label={`${value} out of 5 - ${SCORE_LABEL[value]}`}
              disabled={locked}
              onMouseEnter={() => !locked && setHovered(value)}
              onFocus={() => !locked && setHovered(value)}
              onBlur={() => setHovered(null)}
              onClick={() => {
                setError(undefined);
                setSelected(value);
              }}
              className={cn(
                "flex aspect-square min-w-0 flex-col items-center justify-center gap-2 rounded-xl border px-1 transition-[colors,transform] sm:aspect-auto sm:py-3",
                "focus-visible:ring-2 focus-visible:ring-(--brand-accent)/30 focus-visible:outline-none",
                locked
                  ? "cursor-default"
                  : "hover:border-(--brand-accent)/50 active:scale-95",
                filled
                  ? "border-(--brand-accent)/40 bg-brand-badge"
                  : "bg-background",
              )}
            >
              <Star
                aria-hidden
                className={cn(
                  "size-6 transition-transform",
                  filled
                    ? "fill-brand-accent text-brand-accent"
                    : "text-muted-foreground",
                  current && "scale-110",
                )}
              />
              <span
                aria-hidden
                className={cn(
                  // Below sm five labels do not fit under five stars ("Not
                  // great" and "Excellent" were cut to "Not …" and "Exce…"),
                  // so a phone gets the one line under the row instead.
                  "w-full truncate text-center text-xs leading-tight font-semibold max-sm:hidden",
                  current
                    ? "text-brand-ink"
                    : filled
                      ? "text-foreground/70"
                      : "text-muted-foreground",
                )}
              >
                {SCORE_LABEL[value]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Phone only: the label for whatever the stars show, hover and focus
          included. A fixed-height line, so it filling in does not nudge the
          card. */}
      <p
        aria-hidden
        className={cn(
          "mt-2 h-5 text-sm sm:hidden",
          (hovered ?? score)
            ? "font-bold text-brand-ink"
            : "text-muted-foreground",
        )}
      >
        {(hovered ?? score)
          ? SCORE_LABEL[(hovered ?? score) as number]
          : "Tap a star"}
      </p>

      {/* The comment and Submit arrive with the first star: before that there
          is nothing to submit, and an empty form under the stars made a
          one-tap question look like paperwork. */}
      {!rated && selected !== null ? (
        <div className="mt-4 flex flex-col items-center gap-3 text-left animate-in fade-in slide-in-from-top-1 duration-200">
          <Textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={isSubmitting}
            rows={3}
            maxLength={2000}
            placeholder="Anything you'd like to add? (optional)"
            className="min-h-20 max-h-48 resize-none overflow-y-auto rounded-lg bg-background text-sm"
          />

          <Button
            type="button"
            size="lg"
            className="h-11 w-full px-6 font-semibold sm:w-auto"
            onClick={() => void submit()}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 aria-hidden className="size-4 animate-spin" />
                Submitting…
              </>
            ) : (
              "Submit rating"
            )}
          </Button>
        </div>
      ) : null}

      {rated && csat.comment ? (
        // A left rule, not a box: it marks the customer's own words as
        // something they wrote with the rating, without wrapping them in
        // chrome the thread no longer uses.
        <p className="mt-3.5 border-l-2 border-border pl-3 text-left text-sm leading-[1.55] text-muted-foreground">
          {csat.comment}
        </p>
      ) : null}
    </section>
  );
}
