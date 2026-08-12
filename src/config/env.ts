import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  value === "" ? undefined : value;

const clientSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_SITE_NAME: z.string().min(1),
  NEXT_PUBLIC_SITE_DESCRIPTION: z.string().min(1),

  NEXT_PUBLIC_TWITTER_HANDLE: z.preprocess(
    emptyToUndefined,
    z.string().startsWith("@").optional()
  ),

  NEXT_PUBLIC_SENTRY_DSN: z.preprocess(
    emptyToUndefined,
    z.string().url().optional()
  ),

  NEXT_PUBLIC_SUPABASE_URL: z.preprocess(
    emptyToUndefined,
    z.string().url().optional()
  ),

  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional()
  ),
});

const parsed = clientSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(
    `Invalid environment variables:\n${JSON.stringify(
      parsed.error.flatten().fieldErrors,
      null,
      2
    )}`
  );
}

export const env = parsed.data;