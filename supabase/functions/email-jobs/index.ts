import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { invitationEmailHtml, roleWithArticle } from "./invitation-template.ts";

// Sends the mail queued in public.email_jobs: team invitations and password
// resets (through Supabase Auth) and our own invitation email (through
// Resend).
//
// One caller:
//   1. pg_cron every minute while a job is due -- the sender and retry path
//      for a failed or newly queued job
//
// Both authenticate with the service role key. The gateway checks the
// signature (verify_jwt = true in config.toml); the role check below turns
// away the anon key and signed-in users' tokens, which are valid JWTs too.
//
// claim_email_jobs hands each job to one caller (SKIP LOCKED), so the two can
// run at the same time without sending anything twice.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim();
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")?.trim();
const FROM_EMAIL = Deno.env.get("FROM_EMAIL")?.trim();

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is missing");
}

if (!SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BATCH_SIZE = 10;
const MAX_BATCHES = 5;

type EmailJob = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

type TeamInvitationPayload = {
  userId: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  redirectTo?: string;
  metadata?: Record<string, string>;
};

type PasswordResetPayload = {
  email: string;
  redirectTo: string;
};

/** Retrying won't fix it (mail not configured, unknown kind): fail at once. */
class PermanentEmailError extends Error {}

/** 30s, 2m, 8m, 32m… capped at an hour. */
function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * 4 ** Math.max(0, attempts - 1), 60 * 60 * 1000);
}

function isServiceRole(req: Request): boolean {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");

  if (!token) {
    return false;
  }

  if (token === SERVICE_ROLE_KEY) {
    return true;
  }

  // The gateway has already verified the signature; read the role claim.
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

async function sendResend(message: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  if (!RESEND_API_KEY || !FROM_EMAIL) {
    throw new PermanentEmailError(
      "Email sending is not configured. Set RESEND_API_KEY and FROM_EMAIL.",
    );
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend rejected the email (${response.status}): ${body}`);
  }
}

/**
 * True once the person has signed in and set a password. An invited account
 * stays unconfirmed until then, and Supabase will still re-send an invite to
 * one of those.
 */
async function isRegistered(userId: string): Promise<boolean> {
  const { data, error } = await admin.auth.admin.getUserById(userId);

  if (error || !data.user) {
    return false;
  }

  return Boolean(data.user.email_confirmed_at ?? data.user.confirmed_at);
}

/**
 * Always the "You've been invited" email, never a sign-in email. Supabase's
 * invite only works for an address that has never confirmed an account;
 * anyone who has gets a magic link generated WITHOUT sending, carried in our
 * own invitation email through Resend.
 */
async function sendTeamInvitation({
  userId,
  email,
  name,
  role,
  tenantId,
  redirectTo,
  metadata,
}: TeamInvitationPayload): Promise<void> {
  if (!(await isRegistered(userId))) {
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { ...(name ? { full_name: name } : {}), ...metadata },
      redirectTo,
    });

    if (error) {
      throw new Error(`inviteUserByEmail failed: ${error.message}`);
    }

    return;
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });

  const actionLink = link?.properties?.action_link;

  if (linkError || !actionLink) {
    throw new Error(
      `generateLink failed: ${linkError?.message ?? "no action_link"}`,
    );
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();

  const workspace = (tenant?.name as string | undefined) ?? "your team";

  await sendResend({
    to: email,
    subject: `You've been invited to ${workspace}`,
    html: invitationEmailHtml({ workspace, role, link: actionLink }),
    text: `You've been invited to join ${workspace} as ${roleWithArticle(
      role,
    )}.\n\nAccept the invitation: ${actionLink}\n\nThis link works once and expires in 1 hour. If it has expired, ask your admin to resend the invite.`,
  });
}

/** Supabase's "Reset password" template. A 429 is thrown and retried. */
async function sendPasswordReset({
  email,
  redirectTo,
}: PasswordResetPayload): Promise<void> {
  const { error } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) {
    throw new Error(
      `resetPasswordForEmail failed (${error.status ?? "?"}): ${error.message}`,
    );
  }
}

const HANDLERS: Record<string, (payload: never) => Promise<void>> = {
  team_invitation: sendTeamInvitation,
  password_reset: sendPasswordReset,
};

async function runJob(job: EmailJob): Promise<boolean> {
  const now = new Date();

  try {
    const handler = HANDLERS[job.kind];

    if (!handler) {
      throw new PermanentEmailError(`No handler for email kind "${job.kind}"`);
    }

    await handler(job.payload as never);

    await admin
      .from("email_jobs")
      .update({
        status: "sent",
        sent_at: now.toISOString(),
        updated_at: now.toISOString(),
        locked_at: null,
        last_error: null,
      })
      .eq("id", job.id);

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const giveUp =
      error instanceof PermanentEmailError || job.attempts >= job.max_attempts;

    console.error(
      `[email-jobs] ${job.kind} ${job.id} attempt ${job.attempts} failed${
        giveUp ? " (giving up)" : ""
      }:`,
      message,
    );

    await admin
      .from("email_jobs")
      .update({
        status: giveUp ? "failed" : "pending",
        run_after: new Date(
          now.getTime() + retryDelayMs(job.attempts),
        ).toISOString(),
        updated_at: now.toISOString(),
        locked_at: null,
        last_error: message.slice(0, 2000),
      })
      .eq("id", job.id);

    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ ok: false }, { status: 405 });
  }

  if (!isServiceRole(req)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  let sent = 0;
  let failed = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const { data, error } = await admin.rpc("claim_email_jobs", {
      p_limit: BATCH_SIZE,
    });

    if (error) {
      console.error("[email-jobs] claim failed:", error.message);
      return Response.json({ ok: false, sent, failed }, { status: 500 });
    }

    const jobs = (data ?? []) as EmailJob[];

    if (jobs.length === 0) {
      break;
    }

    const results = await Promise.all(jobs.map(runJob));
    sent += results.filter(Boolean).length;
    failed += results.filter((ok) => !ok).length;

    if (jobs.length < BATCH_SIZE) {
      break;
    }
  }

  return Response.json({ ok: true, sent, failed });
});
