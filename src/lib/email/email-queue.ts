import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import type { TeamRole } from "@/features/team/types/team";

/**
 * The mail the app sends, queued in public.email_jobs -- the mail Supabase
 * sends for us (invite, password reset) and our own invitation email through
 * Resend.
 *
 * The app only writes the job. The sending lives in the `email-jobs` Edge
 * Function (supabase/functions/email-jobs), which pg_cron calls every minute
 * while a job is due. That also retries a failed send with a backoff.
 */

export type TeamInvitationPayload = {
  userId: string;
  email: string;
  name: string;
  role: TeamRole;
  tenantId: string;
  /** Built while the request was live; the function has no request to read it from. */
  redirectTo?: string;
  /**
   * Extra auth user_metadata for the invite. Onboarding sets `tenant_id` and
   * `role` here: the avatar storage policies read `tenant_id` off it.
   */
  metadata?: Record<string, string>;
};

export type PasswordResetPayload = {
  email: string;
  redirectTo: string;
};

type EmailJobPayloads = {
  team_invitation: TeamInvitationPayload;
  password_reset: PasswordResetPayload;
};

export type EmailJobKind = keyof EmailJobPayloads;

/**
 * Adds a job for the scheduled Edge Function to send.
 * Throws if the job can't be written, so the caller can tell the user the
 * mail won't go out.
 *
 * `dedupeKey` names the recipient: a job for the same kind and key that is
 * still waiting is reused (and brought forward) rather than doubled, and an
 * earlier failed one is cleared.
 */
export async function enqueueEmail<K extends EmailJobKind>(
  kind: K,
  payload: EmailJobPayloads[K],
  { tenantId, dedupeKey }: { tenantId?: string; dedupeKey?: string } = {},
): Promise<void> {
  const admin = createSupabaseAdminClient();

  if (dedupeKey) {
    const { data: waiting } = await admin
      .from("email_jobs")
      .select("id")
      .eq("kind", kind)
      .eq("payload->>dedupeKey", dedupeKey)
      .in("status", ["pending", "sending"])
      .limit(1);

    if (waiting && waiting.length > 0) {
      // Asked again while a retry is backing off: send the latest version
      // now rather than at the end of the backoff.
      await admin
        .from("email_jobs")
        .update({
          payload: { ...payload, dedupeKey },
          run_after: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", waiting[0].id)
        .eq("status", "pending");

      return;
    }

    await admin
      .from("email_jobs")
      .delete()
      .eq("kind", kind)
      .eq("payload->>dedupeKey", dedupeKey)
      .eq("status", "failed");
  }

  const { error } = await admin.from("email_jobs").insert({
    kind,
    payload: dedupeKey ? { ...payload, dedupeKey } : payload,
    tenant_id: tenantId ?? null,
  });

  if (error) {
    console.error("[email-queue] enqueue failed:", error.message);
    throw new Error("Couldn't queue the email.");
  }
}
