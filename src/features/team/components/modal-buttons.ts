/**
 * One set of metrics for every Team & roles popup.
 *
 * The invite, change-role, remove and permission dialogs each carried their
 * own padding and their own ad-hoc footer row, so the buttons sat at a
 * different height and the divider above them was there or not depending on
 * the dialog. They all import these now; only the colour treatment is left to
 * the caller, since a confirm, a cancel and a destructive action still need to
 * read differently.
 */

/**
 * The close cross, with the ghost button's filled hover box taken off it so it
 * reads as a glyph rather than a third action beside the footer pair. Done
 * from the outside on purpose: `components/ui/dialog.tsx` is a shadcn
 * component and every other dialog in the app still wants the default.
 */
const TEAM_DIALOG_CLOSE =
  "[&>[data-slot=dialog-close]]:text-muted-foreground [&>[data-slot=dialog-close]]:hover:bg-transparent [&>[data-slot=dialog-close]]:hover:text-foreground [&>[data-slot=dialog-close]]:dark:hover:bg-transparent";

/** Roomier than the dialog default, which left the content tight to the edge. */
export const TEAM_DIALOG_CONTENT = `p-5 ${TEAM_DIALOG_CLOSE}`;

/** 18px semibold, the same weight in all four dialogs. */
export const TEAM_DIALOG_TITLE = "text-lg font-semibold tracking-tight";

/** Inputs and selects share one height so fields line up across dialogs. */
export const TEAM_MODAL_CONTROL = "h-10";

/**
 * Full-bleed footer: the negative margins cancel TEAM_DIALOG_CONTENT so the
 * divider runs edge to edge rather than stopping short of the dialog walls.
 */
export const TEAM_DIALOG_FOOTER =
  "-mx-5 -mb-5 mt-1 gap-3 border-t border-border p-5 sm:justify-end";

export const TEAM_MODAL_BUTTON =
  "h-10 w-full gap-2 rounded-lg px-5 text-sm font-semibold shadow-none duration-200 ease-out motion-safe:active:scale-[0.98] sm:w-auto";

/** The affirmative action in a dialog footer. */
export const TEAM_MODAL_BUTTON_PRIMARY =
  "bg-brand-accent text-brand-accent-foreground hover:bg-brand-accent/90";

/**
 * The destructive action: red on white behind a pale red border, matching the
 * "Cancel subscription" button on the plans screen. A solid red block read as
 * the default choice on a screen where it never is.
 */
export const TEAM_MODAL_BUTTON_DANGER =
  "border border-red-200 bg-background text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/50 dark:hover:bg-red-950/30";
