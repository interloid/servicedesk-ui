import "server-only";

import { z } from "zod";

const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Mail the app sends itself (team invitations to existing accounts).
  // Optional so the app still boots without them; sending fails with a clear
  // error instead. FROM_EMAIL must be on a domain verified in Resend, e.g.
  // "ServiceDesk <team@foxyblog.app>".
  RESEND_API_KEY: optional(z.string().min(1)),
  FROM_EMAIL: optional(z.string().min(3)),
});

const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(
    `Invalid server environment variables:\n${JSON.stringify(
      parsed.error.flatten().fieldErrors,
      null,
      2,
    )}`,
  );
}

export const serverEnv = parsed.data;
