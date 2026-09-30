"use client";

import { toast } from "sonner";

import type { PortalFailure } from "@/features/portal/portal";

/**
 * Toasts for the portal's actions.
 *
 * The portal already renders an inline Alert for failures, and that stays the
 * primary channel: a banner sits next to the form that caused it and does not
 * expire after four seconds. A toast covers the two things the banner cannot:
 *
 *   - success. Before this there was no confirmation anywhere in the portal --
 *     saving a profile closed the dialog silently, and sending a reply emptied
 *     the box. Both read as "did that work?"
 *   - a failure raised away from a form, such as a rejected upload, where there
 *     is no banner to go in.
 *
 * So the split is by *what the toast replaces*, not by severity:
 *
 *   - a failure that is only about fields is NOT toasted. The message belongs on
 *     the input (applyFieldErrors) and in the form's Alert, and a toast cannot
 *     say which input to look at. This is the rule forgot-password-form.tsx
 *     already applies by hand.
 *   - success is toasted only when the customer is navigated away from the thing
 *     that did it, or when the surface holding it closes -- a dialog closing, a
 *     redirect. Where the result stays on screen and is visible (the guest
 *     confirmation panel, the "check your inbox" screen, the CSAT card turning to
 *     a thank-you), the screen is the feedback and a toast on top is noise.
 *     A full page load is the other end of the same rule: sign-out navigates with
 *     window.location.assign, which tears the Toaster down before it can be
 *     read, so there is nothing to fire.
 */

/** Success, for a surface that closed or a redirect that happened. */
export function portalToastSuccess(message: string): void {
  toast.success(message);
}

/** A failure with no form to attach it to. */
export function portalToastError(message: string): void {
  toast.error(message);
}

/**
 * The error channel for an action result, for a form that is also marking up its
 * own fields. Call it after applyFieldErrors; it stays quiet for a field-only
 * failure so the same words are not read twice.
 */
export function portalToastResult(result: PortalFailure): void {
  if (isFieldOnlyFailure(result)) {
    return;
  }

  toast.error(result.message);
}

/** True when every word of the failure has somewhere better to go. */
export function isFieldOnlyFailure(result: PortalFailure): boolean {
  return Object.keys(result.fieldErrors ?? {}).length > 0;
}
