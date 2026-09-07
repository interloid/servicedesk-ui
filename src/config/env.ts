import { z } from "zod";

const clientSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_SITE_NAME: z.string().min(1),
  NEXT_PUBLIC_SITE_DESCRIPTION: z.string().min(1),

  NEXT_PUBLIC_TWITTER_HANDLE: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().startsWith("@").optional(),
  ),

  NEXT_PUBLIC_SENTRY_DSN: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().url().optional(),
  ),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),

  NEXT_PUBLIC_PAYPAL_CLIENT_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),

  // Whether to collect card details in-app with PayPal's hosted card fields.
  // Off by default: card fields for *subscriptions* are a separately gated
  // PayPal capability, and where it is not granted the iframes render but
  // never initialise, leaving the buyer with a form they cannot type into.
  // Turn it on only for a merchant PayPal has enabled it for; otherwise the
  // card option goes to PayPal's own card page, which always works.
  NEXT_PUBLIC_PAYPAL_CARD_FIELDS: z.preprocess(
    (value) => value === "true" || value === "1",
    z.boolean(),
  ),
});

const parsed = clientSchema.safeParse({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME,
  NEXT_PUBLIC_SITE_DESCRIPTION: process.env.NEXT_PUBLIC_SITE_DESCRIPTION,
  NEXT_PUBLIC_TWITTER_HANDLE: process.env.NEXT_PUBLIC_TWITTER_HANDLE,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID,
  NEXT_PUBLIC_PAYPAL_CARD_FIELDS: process.env.NEXT_PUBLIC_PAYPAL_CARD_FIELDS,
});

if (!parsed.success) {
  throw new Error(
    `Invalid client environment variables:\n${JSON.stringify(
      parsed.error.flatten().fieldErrors,
      null,
      2,
    )}`,
  );
}

export const env = parsed.data;
