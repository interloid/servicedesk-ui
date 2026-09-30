import type { ReactNode } from "react";

/**
 * One centred card, the layout every sign-in and onboarding screen uses.
 *
 * This used to be a two-column split with a decorative panel beside the form
 * ("what signing in gets you"). The panel was marketing copy next to the thing
 * it was describing, on a screen whose only job is to collect an email address:
 * it pushed the card off-centre and said nothing the page did not already say.
 * Narrowing it to the card alone is what makes the form read as the subject.
 */
export function PortalSplit({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="w-full rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.06)] sm:p-8">
        {children}
      </div>
    </div>
  );
}
