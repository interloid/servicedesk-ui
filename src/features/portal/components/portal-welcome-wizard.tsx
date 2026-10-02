"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronRight,
  CircleAlert,
  Loader2,
  MessagesSquare,
  Plus,
  SquarePen,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  completeOnboardingAction,
  markWelcomeShownAction,
} from "@/features/portal/actions/portal.actions";
import { PortalCentered } from "@/features/portal/components/portal-shell";
import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";
import { cn } from "@/lib/utils";

const TOTAL_STEPS = 2;

export function PortalWelcomeWizard({
  tenantSlug,
  firstName,
  company,
  firstResponseTarget,
}: {
  tenantSlug: string;
  firstName: string;
  company: string | null;
  /** Plain-language first-response promise, e.g. "4 business hours". */
  firstResponseTarget: string;
}) {
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | undefined>();
  const [isFinishing, setIsFinishing] = useState(false);

  // The wizard is shown once per customer. Stamped from here, once it is on
  // screen, rather than by the page's render: a prefetch renders the page too,
  // and would otherwise spend the wizard before anyone saw it.
  useEffect(() => {
    void markWelcomeShownAction(tenantSlug);
  }, [tenantSlug]);

  /**
   * Every way out of the wizard runs through here, including Skip and the two
   * step-2 cards. Someone who dismissed the tour, or who left it by choosing
   * where to start, has still seen it — re-showing it on their next visit reads
   * as the product forgetting what they did.
   */
  async function finish(destination?: string) {
    setError(undefined);
    setIsFinishing(true);

    const result = await completeOnboardingAction(tenantSlug);

    if (result.success) {
      // No success toast: every exit from here navigates away, and the wizard is
      // a one-time tour -- the screen it lands on is the feedback. Toasting
      // "welcome aboard" would also fire for Skip, which is not an achievement.
      router.replace(destination ?? result.data.redirectTo);
      return;
    }

    setIsFinishing(false);
    setError(result.message);
  }

  // PortalCentered, like the other three screens on the way in: this card was
  // the only one not sitting in the middle of the space between the header and
  // the footer. It brings its own max-w-180 box rather than PortalCard because
  // the wizard is wider than the sign-in card and centres its own text, but the
  // centring is the same wrapper everywhere. my-auto collapses to zero once the
  // wizard is taller than the space, so a short window still scrolls from the
  // top rather than hiding the heading above the scroll origin.
  return (
    <PortalCentered width="max-w-180">
      <div className="w-full rounded-2xl border bg-card p-5 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.06)] sm:p-8 md:p-10">
        <StepIndicator step={step} />

        {error ? (
          <Alert
            variant="destructive"
            className="mt-4 rounded-[10px] px-3.5 py-3 text-left"
          >
            <CircleAlert className="size-4.5" aria-hidden />
            <AlertDescription className="text-sm leading-[1.55]">
              {error}
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Both steps are always laid out, stacked in the same grid cell, and
            the one not showing is hidden and inert. The cell takes the taller
            step's height, so the card is the same size on step 1 and step 2:
            Next and Back no longer resize it and jump the buttons under the
            pointer. Each step's footer is pushed to the bottom, so the
            buttons sit in the same place on both. */}
        <div className="grid">
          <StepPanel active={step === 1}>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-balance text-foreground sm:text-[1.75rem]">
              Welcome, {firstName}
            </h1>

            <p className="mx-auto mt-2 max-w-md text-sm leading-[1.6] text-muted-foreground">
              {company
                ? `Your support account is ready and linked to ${company}, so you'll see every request your team raises with us.`
                : "Your support account is ready. Here's what you can do:"}
            </p>

            <div className="mt-7 grid gap-3 sm:grid-cols-3 sm:gap-4">
              <FeatureCard
                icon={<Plus className="size-5" aria-hidden />}
                title="Create a ticket"
                body="Describe your issue. We'll route it to the right team."
              />
              <FeatureCard
                icon={<MessagesSquare className="size-5" aria-hidden />}
                title="Follow your requests"
                body="Get notified about replies and track progress."
              />
              <FeatureCard
                icon={<BookOpen className="size-5" aria-hidden />}
                title="Browse help centre"
                body="Find guides, setup help and answers to common questions."
              />
            </div>

            <Footer>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="h-11 px-5 font-semibold"
                onClick={() => void finish()}
                disabled={isFinishing}
              >
                Skip for now
              </Button>

              <Button
                type="button"
                size="lg"
                className="h-11 px-6 font-semibold"
                onClick={() => setStep(2)}
                disabled={isFinishing}
              >
                Next
                <ArrowRight aria-hidden className="size-4" />
              </Button>
            </Footer>
          </StepPanel>

          <StepPanel active={step === 2}>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-balance text-foreground sm:text-[1.75rem]">
              Where do you want to start?
            </h1>

            <p className="mx-auto mt-2 max-w-md text-sm leading-[1.6] text-muted-foreground">
              Most answers are already written up. If yours isn&apos;t, raise it
              and we&apos;ll pick it up against your SLA.
            </p>

            <div className="mt-7 grid gap-3 text-left sm:grid-cols-2 sm:gap-4">
              <ChoiceCard
                onSelect={() =>
                  void finish(portalPath(tenantSlug, PORTAL_ROUTES.NEW_REQUEST))
                }
                disabled={isFinishing}
                icon={<SquarePen className="size-5" aria-hidden />}
                title="Create a ticket"
                body={`Describe the problem. First reply within ${firstResponseTarget} on your plan.`}
              />
              <ChoiceCard
                onSelect={() =>
                  void finish(portalPath(tenantSlug, PORTAL_ROUTES.HELP))
                }
                disabled={isFinishing}
                icon={<BookOpen className="size-5" aria-hidden />}
                title="Browse the help centre"
                body="Setup guides, SSO troubleshooting, and billing answers."
              />
            </div>

            <Footer>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="h-11 px-5 font-semibold"
                onClick={() => setStep(1)}
                disabled={isFinishing}
              >
                <ArrowLeft aria-hidden className="size-4" />
                Back
              </Button>

              <Button
                type="button"
                size="lg"
                className="h-11 px-6 font-semibold"
                onClick={() => void finish()}
                disabled={isFinishing}
              >
                {isFinishing ? (
                  <>
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                    Just a moment…
                  </>
                ) : (
                  "Go to my requests"
                )}
              </Button>
            </Footer>
          </StepPanel>
        </div>
      </div>
    </PortalCentered>
  );
}

/**
 * One step, placed in the shared grid cell. The inactive one keeps its space
 * but is invisible and inert -- out of the tab order and the accessibility
 * tree -- so only the active step can be read or clicked.
 */
function StepPanel({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      inert={!active}
      className={cn(
        "col-start-1 row-start-1 flex flex-col",
        active ? "animate-in fade-in duration-200" : "invisible",
      )}
    >
      {children}
    </div>
  );
}

function StepIndicator({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-2.5">
      <div className="flex items-center gap-1.5" aria-hidden>
        {Array.from({ length: TOTAL_STEPS }, (_, index) => index + 1).map(
          (value) => (
            <span
              key={value}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                value === step
                  ? "w-6 bg-brand-accent"
                  : "w-1.5 bg-brand-accent/30",
              )}
            />
          ),
        )}
      </div>
    </div>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="mt-auto grid grid-cols-1 gap-2.5 pt-8 sm:flex sm:justify-end sm:gap-3">
      {children}
    </div>
  );
}

/**
 * Centred tiles from `sm` up; on a phone a stacked tile wastes most of its
 * height, so each one becomes a row with the icon on the left.
 */
function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3.5 rounded-xl border bg-card p-4 text-left sm:flex-col sm:items-center sm:p-5 sm:text-center">
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-accent/10 text-brand-accent"
      >
        {icon}
      </span>

      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

/**
 * A button rather than a link: choosing where to start also closes out the
 * wizard, so the navigation has to wait for that write to land.
 */
function ChoiceCard({
  onSelect,
  disabled,
  icon,
  title,
  body,
}: {
  onSelect: () => void;
  disabled?: boolean;
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "group flex items-start gap-3.5 rounded-xl border bg-card p-4 text-left transition-all sm:p-5",
        "hover:-translate-y-0.5 hover:border-brand-accent/40 hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)]",
        "focus-visible:ring-2 focus-visible:ring-brand-accent/30 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-60",
      )}
    >
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-accent/10 text-brand-accent"
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {title}
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {body}
        </span>
      </span>

      <ChevronRight
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand-accent"
      />
    </button>
  );
}
