import { z } from "zod";

import {
  DEFAULT_BRAND_COLOR,
  DEFAULT_SHOW_LOGO_ON_PORTAL,
  HEX_COLOR,
  MAX_NAME_LENGTH,
  MAX_SLUG_LENGTH,
  SLUG_PATTERN,
} from "@/features/branding/branding";

const name = z
  .string()
  .trim()
  .min(1, "Give your workspace a name.")
  .max(MAX_NAME_LENGTH, `Keep the name under ${MAX_NAME_LENGTH} characters.`);

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter a portal address.")
  .max(
    MAX_SLUG_LENGTH,
    `Keep the address to ${MAX_SLUG_LENGTH} characters or fewer.`,
  )
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

const textColor = optionalColor("Enter a hex color like #0F172A.");
const backgroundColor = optionalColor("Enter a hex color like #F8FAFC.");

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
  textColor,
  backgroundColor,
  logoUrl,
  showLogoOnPortal,
});

export const updateBrandingSchema = brandingInput;

export type UpdateBrandingValues = z.infer<typeof updateBrandingSchema>;
