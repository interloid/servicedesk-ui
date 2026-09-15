"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  Loader2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { cancelSubscriptionAction } from "../billing-actions";
import type { BillingDashboardData } from "../services/billing-dashboard.service";
import type { FormattedPlan } from "../types";
import { MODAL_BUTTON } from "./modal-buttons";
import { ModalNotice } from "./modal-notice";

// Matches the destructive confirm on the downgrade dialog: outlined red rather
// than solid, so the dismissive action stays the visually quieter one.
const CONFIRM_DANGER =
  "border-red-600 bg-background text-red-600 hover:border-red-600 hover:bg-red-50 hover:text-red-600 disabled:border-red-300 disabled:bg-background disabled:text-red-300 disabled:opacity-100 dark:hover:bg-red-950/30";

interface CancelSubscriptionDialogProps {
  tenantSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  billingData: BillingDashboardData;
  freePlan?: FormattedPlan | null;
}

// Kept to the reasons that actually change a decision on our side. Product
// complaints ("missing features", "technical issues", "too difficult to use")
// belong in support tickets, where they reach someone who can act on them --
// as a radio button they only produced an unattributed tally.
const CANCEL_REASONS = [
  "Too expensive",
  "No longer needed",
  "Found a better alternative",
  "Other",
] as const;

const OTHER_REASON = "Other";

export function CancelSubscriptionDialog({
  tenantSlug,
  open,
  onOpenChange,
  billingData,
  freePlan = null,
}: CancelSubscriptionDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"confirm" | "final">("confirm");
  const [error, setError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [otherReason, setOtherReason] = useState<string>("");

  const plan = billingData.plan;
  const renewalDate = billingData.renewalDate;
  const seats = billingData.seats;
  const scheduledChange = billingData.scheduledChange;

  const isFreePlan = plan.rateValue === 0;

  // A cancellation is itself stored as a scheduled switch to the $0 plan, which
  // is why billingStatus reads "cancelled" while one is pending. Treating that
  // as a generic "plan change" told a user who had just cancelled to cancel
  // their cancellation first, which read as the button not working.
  const alreadyCancelled = billingData.billingStatus === "cancelled";
  const hasScheduledPlanChange = scheduledChange !== null && !alreadyCancelled;

  const endsOn = renewalDate !== "N/A" ? renewalDate : null;
  const freePlanName = freePlan?.name ?? "Free";

  const freeSeatLimit = freePlan?.seatLimit ?? null;
  const seatsOverFreeLimit =
    freeSeatLimit !== null && seats.used > freeSeatLimit
      ? seats.used - freeSeatLimit
      : 0;

  // Every exit routes through here so the flow always reopens on step one
  // rather than on whichever step it was abandoned at.
  const close = () => {
    if (isPending) return;
    onOpenChange(false);
    setStep("confirm");
    setError(null);
  };

  const handleCancel = () => {
    startTransition(async () => {
      setError(null);

      // Free text only matters when "Other" is the choice, and it stays
      // optional either way.
      const reason =
        cancelReason === OTHER_REASON
          ? otherReason.trim() || OTHER_REASON
          : cancelReason;

      try {
        const result = await cancelSubscriptionAction(
          tenantSlug,
          reason || undefined,
        );

        if (!result.success) {
          setError(result.error || "Failed to cancel subscription.");
          return;
        }

        if (result.scheduled) {
          toast.success(
            `Subscription cancelled. Your ${plan.name} plan stays active until ${renewalDate}.`,
          );
        } else {
          toast.success(
            "Subscription cancelled. You are now on the Free plan.",
          );
        }

        onOpenChange(false);
        setStep("confirm");
        // The popup closes back onto the plans page, so the cards behind it
        // have to pick up the pending cancellation straight away.
        router.refresh();
      } catch (err) {
        console.error("Cancel error:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
        );
      }
    });
  };

  const blockedState = isFreePlan
    ? {
        title: "You're already on the Free plan",
        body: (
          <ModalNotice icon={Check} tone="neutral">
            There is no subscription to cancel. You can upgrade again at any
            time from this page.
          </ModalNotice>
        ),
      }
    : alreadyCancelled
      ? {
          title: "Your subscription is already cancelled",
          body: (
            <ModalNotice icon={CalendarClock} tone="amber">
              {endsOn ? (
                <>
                  You keep full access to your {plan.name} plan until{" "}
                  <strong className="font-semibold">{endsOn}</strong>. After
                  that, your account moves to the {freePlanName} plan. You will
                  not be charged again.
                </>
              ) : (
                <>
                  Your account will move to the {freePlanName} plan at the end
                  of the current period. You will not be charged again.
                </>
              )}
            </ModalNotice>
          ),
        }
      : hasScheduledPlanChange && scheduledChange
        ? {
            title: "Plan change already scheduled",
            body: (
              <ModalNotice icon={CalendarClock} tone="amber">
                You have a pending switch to {scheduledChange.planName}{" "}
                effective{" "}
                {new Date(scheduledChange.effectiveAt).toLocaleDateString(
                  "en-US",
                  { month: "long", day: "numeric", year: "numeric" },
                )}
                . Cancel that change first, then cancel your subscription.
              </ModalNotice>
            ),
          }
        : null;

  const title = blockedState
    ? blockedState.title
    : step === "confirm"
      ? `Cancel your ${plan.name} plan?`
      : "Confirm cancellation";

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <AlertDialogContent
        className="
            w-[calc(100%-2rem)]
            data-[size=default]:max-w-120
            data-[size=default]:sm:max-w-145
            rounded-2xl
            border
            border-border
            bg-background
            p-0
            shadow-xl
            overflow-hidden
          "
      >
        <AlertDialogHeader className="block px-6 pt-5 pb-4 text-left">
          <div className="flex w-full items-center justify-between gap-4">
            <AlertDialogTitle className="text-xl font-bold text-foreground">
              {title}
            </AlertDialogTitle>

            <button
              type="button"
              onClick={close}
              disabled={isPending}
              className="-mr-1.5 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors duration-200 ease-out hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 motion-safe:active:scale-[0.98]"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <AlertDialogDescription asChild>
            <div className="mt-4 max-h-[55vh] space-y-3 overflow-y-auto w-full">
              {blockedState ? (
                blockedState.body
              ) : step === "confirm" ? (
                <>
                  <ModalNotice icon={Users} tone="neutral">
                    <span className="font-semibold text-foreground">
                      {plan.name} plan
                    </span>{" "}
                    · {plan.rate}
                    {endsOn ? ` · Renews ${endsOn}` : ""} · {seats.used} of{" "}
                    {seats.total} seats used
                  </ModalNotice>

                  <ModalNotice
                    icon={AlertTriangle}
                    tone="amber"
                    title="What happens after you cancel"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-background px-2 py-1 text-xs font-semibold text-foreground ring-1 ring-amber-200 dark:ring-amber-900/50">
                        {plan.name}
                      </span>
                      <ArrowRight
                        aria-hidden
                        className="h-4 w-4 shrink-0 text-amber-500"
                      />
                      <span className="rounded-md bg-background px-2 py-1 text-xs font-semibold text-foreground ring-1 ring-amber-200 dark:ring-amber-900/50">
                        {freePlanName}
                      </span>
                      {endsOn && (
                        <span className="text-xs">
                          on <strong className="font-semibold">{endsOn}</strong>
                        </span>
                      )}
                    </div>

                    <ul className="mt-3 space-y-2.5">
                      <li className="flex items-start gap-2">
                        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                        {endsOn ? (
                          <span>
                            You keep your {plan.name} plan and everything in it
                            until{" "}
                            <strong className="font-semibold">{endsOn}</strong>.
                            Nothing changes before then.
                          </span>
                        ) : (
                          <span>
                            Your account moves to the {freePlanName} plan
                            immediately.
                          </span>
                        )}
                      </li>

                      <li className="flex items-start gap-2">
                        <Users className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                        {freeSeatLimit !== null ? (
                          <span>
                            Your seat limit drops from{" "}
                            <strong className="font-semibold">
                              {seats.total}
                            </strong>{" "}
                            to{" "}
                            <strong className="font-semibold">
                              {freeSeatLimit}
                            </strong>
                            .{" "}
                            {seatsOverFreeLimit > 0 ? (
                              <span className="font-semibold">
                                You have {seats.used} members, so{" "}
                                {seatsOverFreeLimit} will lose access unless you
                                remove them first.
                              </span>
                            ) : (
                              <>
                                Your {seats.used} current member
                                {seats.used === 1 ? "" : "s"} still fit.
                              </>
                            )}
                          </span>
                        ) : (
                          <span>
                            Your seat limit drops from {seats.total} to the{" "}
                            {freePlanName} plan limit.
                          </span>
                        )}
                      </li>

                      <li className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                        <span>
                          {freePlan ? (
                            <>
                              The {freePlanName} plan includes{" "}
                              {freePlan.ticketLimitText} tickets and{" "}
                              {freePlan.storageLimitText} storage. Paid-plan
                              features such as SLA policies and priority support
                              are no longer available.
                            </>
                          ) : (
                            <>
                              Paid-plan features such as SLA policies and
                              priority support are no longer available.
                            </>
                          )}
                        </span>
                      </li>
                    </ul>
                  </ModalNotice>

                  {error && <ErrorNote>{error}</ErrorNote>}
                </>
              ) : (
                <>
                  <ModalNotice
                    icon={AlertTriangle}
                    tone="amber"
                    title="Your subscription will be cancelled"
                  >
                    {endsOn ? (
                      <>
                        You&apos;ll keep access to your {plan.name} plan until{" "}
                        <strong className="font-semibold">{endsOn}</strong>.
                        After that, your account will move to the {freePlanName}{" "}
                        plan.
                      </>
                    ) : (
                      <>
                        Your account will move to the {freePlanName} plan
                        immediately.
                      </>
                    )}
                  </ModalNotice>

                  <div className="rounded-xl border border-border px-4 py-3.5">
                    <p className="text-sm font-semibold text-foreground">
                      What&apos;s the reason for cancelling?
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Optional — your feedback helps us improve.
                    </p>

                    <RadioGroup
                      value={cancelReason}
                      onValueChange={setCancelReason}
                      className="mt-3"
                    >
                      {CANCEL_REASONS.map((reason) => {
                        // The id has to be slug-safe: an id containing a space
                        // is invalid HTML and the label stops resolving to its
                        // input, so every reason except the single-word "Other"
                        // was unclickable.
                        const id = `cancel-reason-${reason.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

                        return (
                          <Label
                            key={reason}
                            htmlFor={id}
                            data-state={
                              cancelReason === reason ? "checked" : "unchecked"
                            }
                            className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-normal text-foreground transition-colors hover:border-slate-300 data-[state=checked]:border-brand-accent data-[state=checked]:bg-accent/50"
                          >
                            <RadioGroupItem value={reason} id={id} />
                            {reason}
                          </Label>
                        );
                      })}
                    </RadioGroup>

                    {cancelReason === OTHER_REASON && (
                      <div className="mt-3">
                        <Label
                          htmlFor="cancel-reason-other-text"
                          className="text-xs font-medium text-muted-foreground"
                        >
                          Tell us more (optional)
                        </Label>
                        <Textarea
                          id="cancel-reason-other-text"
                          value={otherReason}
                          onChange={(event) =>
                            setOtherReason(event.target.value)
                          }
                          placeholder="What made you decide to cancel?"
                          rows={3}
                          maxLength={500}
                          className="mt-1.5 resize-none"
                        />
                      </div>
                    )}
                  </div>

                  {error && <ErrorNote>{error}</ErrorNote>}

                  {endsOn && (
                    <p className="text-xs text-muted-foreground">
                      You can continue using your {plan.name} plan until{" "}
                      <strong className="font-semibold text-foreground">
                        {endsOn}
                      </strong>
                      .
                    </p>
                  )}
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="mx-0 mb-0 gap-3 px-4 py-4 sm:justify-end">
          {blockedState ? (
            <AlertDialogCancel className={cn(MODAL_BUTTON, "mt-0")}>
              Close
            </AlertDialogCancel>
          ) : step === "confirm" ? (
            <>
              <AlertDialogCancel
                disabled={isPending}
                className={cn(MODAL_BUTTON, "mt-0")}
              >
                Keep my plan
              </AlertDialogCancel>
              <AlertDialogAction
                variant="outline"
                disabled={isPending}
                onClick={(event) => {
                  event.preventDefault();
                  setStep("final");
                }}
                className={cn(MODAL_BUTTON, CONFIRM_DANGER)}
              >
                Continue to cancel
              </AlertDialogAction>
            </>
          ) : (
            <>
              <AlertDialogCancel
                disabled={isPending}
                onClick={(event) => {
                  event.preventDefault();
                  setStep("confirm");
                }}
                className={cn(MODAL_BUTTON, "mt-0")}
              >
                Go back
              </AlertDialogCancel>
              <AlertDialogAction
                variant="outline"
                disabled={isPending}
                onClick={(event) => {
                  event.preventDefault();
                  handleCancel();
                }}
                className={cn(MODAL_BUTTON, CONFIRM_DANGER)}
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  "Cancel subscription"
                )}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
      {children}
    </div>
  );
}

export default CancelSubscriptionDialog;
