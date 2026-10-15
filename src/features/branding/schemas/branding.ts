import { z } from "zod";

import {
  DEFAULT_BRAND_COLOR,
  DEFAULT_SHOW_LOGO_ON_PORTAL,
} from "@/features/branding/branding";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const name = z
  .string()
  .trim()
  .min(1, "Give your workspace a name.")
  .max(120, "Keep the name under 120 characters.");

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter a portal address.")
  .max(63, "Keep the address to 63 characters or fewer.")
  .regex(SLUG_PATTERN, "Use lowercase letters, numbers and hyphens only.");

const primaryColor = z
  .string()
  .trim()
  .regex(HEX_COLOR, "Enter a hex color like #0F766E.");

/**
 * The colours beyond the primary are optional, and an empty string is a
 * meaningful value: it clears the override so the app default applies again.
 * Required-with-a-default would make "unset" impossible to express.
 */
function optionalColor(message: string) {
  return z
    .string()
    .trim()
    .regex(HEX_COLOR, message)
    .or(z.literal(""))
    .optional();
}

const secondaryColor = optionalColor("Enter a hex color like #F1F5F9.");
const textColor = optionalColor("Enter a hex color like #0F172A.");
const backgroundColor = optionalColor("Enter a hex color like #F8FAFC.");

const supportEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid support email.")
  .max(254, "That email is too long.")
  .or(z.literal(""));

const logoUrl = z
  .string()
  .trim()
  .url("Use a full URL for the logo.")
  .max(2048, "That logo URL is too long.")
  .or(z.literal(""))
  .optional();

const showLogoOnPortal = z.boolean().default(DEFAULT_SHOW_LOGO_ON_PORTAL);

const brandingInput = z.object({
  name,
  slug,
  primaryColor: primaryColor.default(DEFAULT_BRAND_COLOR),
  secondaryColor,
  textColor,
  backgroundColor,
  supportEmail,
  logoUrl,
  showLogoOnPortal,
});

export const updateBrandingSchema = brandingInput;

export type UpdateBrandingValues = z.infer<typeof updateBrandingSchema>;
