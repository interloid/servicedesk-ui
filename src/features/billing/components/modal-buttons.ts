/**
 * One button size for every billing popup.
 *
 * The plan-switch alert, the downgrade alert, the invoice modal, the Manage
 * PayPal modal and the plan-details dialog each carried their own height,
 * padding, type scale and radius, so buttons changed shape from one dialog to
 * the next. They all import these metrics now; only the colour treatment is
 * left to the caller, since a confirm, a cancel and a destructive action still
 * need to read differently.
 */

export const MODAL_BUTTON =
  "h-10 w-full gap-2 rounded-lg px-5 text-sm font-semibold shadow-none duration-200 ease-out motion-safe:active:scale-[0.98] sm:w-auto";

/** The affirmative action in a dialog footer. */
export const MODAL_BUTTON_PRIMARY =
  "bg-brand-accent text-brand-accent-foreground hover:bg-brand-accent/90";
