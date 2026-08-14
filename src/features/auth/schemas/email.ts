import { z } from "zod";

/**
 * The one email rule the auth screens share.
 *
 * Deliberately loose — this only has to reject obvious non-addresses client-side. It was
 * duplicated verbatim in login, signup and forgot-password before the schemas existed;
 * the pattern is unchanged, only its home is.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Each screen words its own "you left this blank" copy ("Enter your work email" on login,
 * "Enter your email address" on signup), but they all agree on the malformed-address one.
 */
export function emailField(requiredMessage: string) {
  return z
    .string()
    .trim()
    .min(1, requiredMessage)
    .regex(EMAIL_PATTERN, "Enter a valid email address");
}
