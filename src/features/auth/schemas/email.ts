import { z } from "zod";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailField(requiredMessage: string) {
  return z
    .string()
    .trim()
    .min(1, requiredMessage)
    .regex(EMAIL_PATTERN, "Enter a valid email address");
}
