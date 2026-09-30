"use server";

import { revalidatePath } from "next/cache";

import {
  PORTAL_ROUTES,
  portalPath,
  portalRequestPath,
  type PortalFailure,
  type PortalNextStep,
  type PortalResult,
  type PortalUploadedFile,
  type PortalUploadTarget,
} from "@/features/portal/portal";
import {
  portalEmailSchema,
  portalGuestRequestSchema,
  portalPasswordLoginSchema,
  portalProfileSchema,
  portalRequestSchema,
  portalCsatSchema,
  portalReplySchema,
  portalSetPasswordSchema,
  type PortalEmailValues,
  type PortalGuestRequestValues,
  type PortalPasswordLoginValues,
  type PortalProfileValues,
  type PortalCsatValues,
  type PortalReplyValues,
  type PortalRequestValues,
  type PortalSetPasswordValues,
} from "@/features/portal/schemas/portal.schema";
import {
  addPortalCsatComment,
  completePortalOnboarding,
  createPortalRequest,
  createPortalStagingTargets,
  createPortalUploadTargets,
  getPortalIdentity,
  portalPasswordSignIn,
  PortalError,
  preparePortalAvatarUpload,
  updatePortalProfile,
  portalSignOut,
  postPortalReply,
  reopenPortalRequest,
  isTeamEmail,
  sendPortalSignInLink,
  TEAM_ACCOUNT_MESSAGE,
  setPortalPassword,
  submitPortalCsat,
  stepPath,
} from "@/features/portal/services/portal.service";
import { clientKey, rateLimit } from "@/lib/rate-limit";

const MINUTE = 60_000;

/**
 * Every entry point here is reachable as a bare POST, not only through the UI,
 * and two of them (the sign-in email and the guest request) cost real money or
 * write rows for an unauthenticated caller. The limits are per client IP and
 * deliberately tighter than Supabase's own.
 */
const LIMITS = {
  sendLink: { limit: 5, windowMs: 10 * MINUTE },
  password: { limit: 10, windowMs: 10 * MINUTE },
  guestRequest: { limit: 3, windowMs: 15 * MINUTE },
  // One per file, so this is roughly a dozen replies' worth of attachments.
  upload: { limit: 60, windowMs: 10 * MINUTE },
} as const;

type Limit = keyof typeof LIMITS;

async function guard(action: Limit): Promise<PortalFailure | null> {
  const key = `portal:${action}:${await clientKey()}`;

  const { allowed, retryAfterMs } = rateLimit(key, LIMITS[action]);

  if (allowed) {
    return null;
  }

  const minutes = Math.max(1, Math.ceil(retryAfterMs / MINUTE));

  return {
    success: false,
    code: "rate_limited",
    message: `Too many attempts. Try again in ${minutes} minute${
      minutes === 1 ? "" : "s"
    }.`,
  };
}

function invalid(
  fieldErrors: Record<string, string[] | undefined>,
): PortalFailure {
  return {
    success: false,
    code: "validation",
    message: "Check the highlighted fields and try again.",
    fieldErrors: fieldErrors as Record<string, string[]>,
  };
}

function failure(error: unknown, fallback: string): PortalFailure {
  if (error instanceof PortalError) {
    return { success: false, code: error.code, message: error.message };
  }

  console.error("[portal] action failed:", error);

  return { success: false, code: "unknown", message: fallback };
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

export async function requestSignInLinkAction(
  slug: string,
  values: PortalEmailValues,
): Promise<PortalResult<{ email: string }>> {
  const parsed = portalEmailSchema.safeParse(values);

  if (!parsed.success) {
    return invalid(parsed.error.flatten().fieldErrors);
  }

  const limited = await guard("sendLink");
  if (limited) return limited;

  try {
    await sendPortalSignInLink(slug, parsed.data.email);

    return { success: true, data: { email: parsed.data.email } };
  } catch (error) {
    return failure(
      error,
      "We couldn't send that email. Try again in a moment.",
    );
  }
}

export async function passwordSignInAction(
  slug: string,
  values: PortalPasswordLoginValues,
): Promise<PortalResult<{ redirectTo: string }>> {
  const parsed = portalPasswordLoginSchema.safeParse(values);

  if (!parsed.success) {
    return invalid(parsed.error.flatten().fieldErrors);
  }

  const limited = await guard("password");
  if (limited) return limited;

  try {
    const step = await portalPasswordSignIn(
      slug,
      parsed.data.email,
      parsed.data.password,
    );

    return { success: true, data: { redirectTo: stepPath(slug, step) } };
  } catch (error) {
    return failure(error, "We couldn't sign you in. Try again in a moment.");
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** Step one of a photo change: a single-use token to upload it with. */
export async function prepareAvatarUploadAction(
  slug: string,
  file: { size: number; type: string },
): Promise<PortalResult<{ path: string; token: string }>> {
  const identity = await getPortalIdentity(slug);

  if (!identity) {
    return {
      success: false,
      code: "not_signed_in",
      message: "Your session has expired. Sign in again.",
    };
  }

  try {
    return {
      success: true,
      data: await preparePortalAvatarUpload(identity, file),
    };
  } catch (error) {
    return failure(error, "We couldn't start that upload. Try again.");
  }
}

/** Save Profile settings; `avatarPath` is set only when a new photo was uploaded. */
export async function updateProfileAction(
  slug: string,
  values: PortalProfileValues,
  avatarPath?: string | null,
): Promise<PortalResult> {
  const parsed = portalProfileSchema.safeParse(values);

  if (!parsed.success) {
    return invalid(parsed.error.flatten().fieldErrors);
  }

  const identity = await getPortalIdentity(slug);

  if (!identity) {
    return {
      success: false,
      code: "not_signed_in",
      message: "Your session has expired. Sign in again.",
    };
  }

  try {
    await updatePortalProfile(identity, {
      fullName: parsed.data.fullName,
      company: parsed.data.company,
      avatarPath,
    });

    // The header on every portal screen shows the name and photo; the welcome
    // copy and the team's customer page read the company.
    revalidatePath(portalPath(slug, PORTAL_ROUTES.ROOT), "layout");

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, "We couldn't save your profile. Try again.");
  }
}

export async function signOutAction(
  slug: string,
): Promise<PortalResult<{ redirectTo: string }>> {
  await portalSignOut();

  return {
    success: true,
    data: { redirectTo: portalPath(slug, PORTAL_ROUTES.LOGIN) },
  };
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

/**
 * The password step is optional by design — "Your requests are already visible
 * either way." Saving one only moves the customer on to the next step; it is
 * never a gate.
 */
export async function setPasswordAction(
  slug: string,
  values: PortalSetPasswordValues,
): Promise<PortalResult<{ redirectTo: string }>> {
  const parsed = portalSetPasswordSchema.safeParse(values);

  if (!parsed.success) {
    return invalid(parsed.error.flatten().fieldErrors);
  }

  const identity = await getPortalIdentity(slug);

  if (!identity) {
    return {
      success: false,
      code: "not_signed_in",
      message: "Your session has expired. Sign in again.",
    };
  }

  try {
    await setPortalPassword(parsed.data.password);

    const next: PortalNextStep = identity.customer.onboarded
      ? "requests"
      : "welcome";

    return { success: true, data: { redirectTo: stepPath(slug, next) } };
  } catch (error) {
    return failure(error, "We couldn't save that password. Try again.");
  }
}

export async function completeOnboardingAction(
  slug: string,
): Promise<PortalResult<{ redirectTo: string }>> {
  const identity = await getPortalIdentity(slug);

  if (!identity) {
    return {
      success: false,
      code: "not_signed_in",
      message: "Your session has expired. Sign in again.",
    };
  }

  try {
    // The welcome page stamps this as it renders, so by the time the wizard's
    // buttons call here it is normally already done -- nothing to write.
    if (!identity.customer.onboarded) {
      await completePortalOnboarding(slug, identity.userId);
    }

    revalidatePath(portalPath(slug, PORTAL_ROUTES.REQUESTS));

    return {
      success: true,
      data: { redirectTo: portalPath(slug, PORTAL_ROUTES.REQUESTS) },
    };
  } catch (error) {
    return failure(error, "We couldn't save that. Try again in a moment.");
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * Authorise attachments for a request that has not been submitted yet.
 *
 * Open to guests on purpose -- the portal accepts requests without an account.
 * The paths it hands back are server-minted under a random batch id and are
 * only useful to whoever received them; rate limiting is what keeps this from
 * being free storage.
 */
export async function prepareRequestUploadsAction(
  slug: string,
  files: { name: string; size: number; type?: string }[],
): Promise<PortalResult<{ targets: PortalUploadTarget[] }>> {
  const limited = await guard("upload");
  if (limited) return limited;

  try {
    const targets = await createPortalStagingTargets(slug, files);

    return { success: true, data: { targets } };
  } catch (error) {
    return failure(error, "We couldn't start that upload. Try again.");
  }
}

export async function submitRequestAction(
  slug: string,
  values: PortalRequestValues,
  uploads: PortalUploadedFile[] = [],
): Promise<PortalResult<{ redirectTo: string; number: number | null }>> {
  const parsed = portalRequestSchema.safeParse(values);

  if (!parsed.success) {
    return invalid(parsed.error.flatten().fieldErrors);
  }

  const identity = await getPortalIdentity(slug);

  if (!identity) {
    return {
      success: false,
      code: "not_signed_in",
      message: "Your session has expired. Sign in again.",
    };
  }

  try {
    const ticket = await createPortalRequest({
      slug,
      subject: parsed.data.subject,
      description: parsed.data.description,
      email: identity.customer.email,
      fullName: identity.customer.fullName,
      userId: identity.userId,
      uploads,
    });

    revalidatePath(portalPath(slug, PORTAL_ROUTES.REQUESTS));

    return {
      success: true,
      data: {
        redirectTo: portalPath(slug, PORTAL_ROUTES.REQUESTS),
        number: ticket.number,
      },
    };
  } catch (error) {
    return failure(error, "We couldn't submit your request. Try again.");
  }
}

/**
 * "You don't need an account to reach us." Creates the customer row as a side
 * effect, so when that same address later signs in, portal_link_user claims
 * this ticket rather than starting a second history.
 */
export async function submitGuestRequestAction(
  slug: string,
  values: PortalGuestRequestValues,
  uploads: PortalUploadedFile[] = [],
): Promise<PortalResult<{ email: string; number: number | null }>> {
  const parsed = portalGuestRequestSchema.safeParse(values);

  if (!parsed.success) {
    return invalid(parsed.error.flatten().fieldErrors);
  }

  const limited = await guard("guestRequest");
  if (limited) return limited;

  try {
    // A guest request is how a new customer's account begins, so a team
    // email is refused here as well as at sign-in.
    if (await isTeamEmail(parsed.data.email)) {
      throw new PortalError(TEAM_ACCOUNT_MESSAGE, "no_portal_access");
    }

    const ticket = await createPortalRequest({
      slug,
      subject: parsed.data.subject,
      description: parsed.data.description,
      email: parsed.data.email,
      fullName: parsed.data.fullName || undefined,
      uploads,
    });

    return {
      success: true,
      data: { email: parsed.data.email, number: ticket.number },
    };
  } catch (error) {
    return failure(error, "We couldn't submit your request. Try again.");
  }
}

/**
 * Authorise a set of attachments and hand the browser one upload URL each.
 *
 * The file bytes deliberately do NOT come through here: a Server Action body is
 * capped at 1 MB by default and 4.5 MB by the platform, so anything worth
 * attaching would fail. The browser uploads straight to Storage with these
 * tokens and then reports the paths back to postReplyAction.
 */
export async function prepareReplyUploadsAction(
  slug: string,
  requestId: string,
  files: { name: string; size: number; type?: string }[],
): Promise<PortalResult<{ targets: PortalUploadTarget[] }>> {
  const identity = await getPortalIdentity(slug);

  if (!identity) {
    return {
      success: false,
      code: "not_signed_in",
      message: "Your session has expired. Sign in again.",
    };
  }

  const limited = await guard("upload");
  if (limited) return limited;

  try {
    const targets = await createPortalUploadTargets(identity, requestId, files);

    return { success: true, data: { targets } };
  } catch (error) {
    return failure(error, "We couldn't start that upload. Try again.");
  }
}

/**
 * `uploads` names files the browser has already put in the bucket. Everything
 * about them is re-checked server-side -- see recordPortalAttachments.
 */
export async function postReplyAction(
  slug: string,
  requestId: string,
  values: PortalReplyValues,
  uploads: PortalUploadedFile[] = [],
): Promise<PortalResult<null>> {
  const parsed = portalReplySchema.safeParse(values);

  if (!parsed.success) {
    return invalid(parsed.error.flatten().fieldErrors);
  }

  const identity = await getPortalIdentity(slug);

  if (!identity) {
    return {
      success: false,
      code: "not_signed_in",
      message: "Your session has expired. Sign in again.",
    };
  }

  try {
    await postPortalReply(identity, requestId, parsed.data.body, uploads);

    revalidatePath(portalRequestPath(slug, requestId));
    revalidatePath(portalPath(slug, PORTAL_ROUTES.REQUESTS));

    return { success: true, data: null };
  } catch (error) {
    return failure(error, "We couldn't post that reply. Try again.");
  }
}

export async function reopenRequestAction(
  slug: string,
  requestId: string,
): Promise<PortalResult<null>> {
  const identity = await getPortalIdentity(slug);

  if (!identity) {
    return {
      success: false,
      code: "not_signed_in",
      message: "Your session has expired. Sign in again.",
    };
  }

  try {
    await reopenPortalRequest(identity, requestId);

    revalidatePath(portalRequestPath(slug, requestId));
    revalidatePath(portalPath(slug, PORTAL_ROUTES.REQUESTS));

    return { success: true, data: null };
  } catch (error) {
    return failure(error, "We couldn't reopen that request. Try again.");
  }
}

export async function submitCsatAction(
  slug: string,
  requestId: string,
  values: PortalCsatValues,
): Promise<PortalResult<null>> {
  const parsed = portalCsatSchema.safeParse(values);

  if (!parsed.success) {
    return invalid(parsed.error.flatten().fieldErrors);
  }

  const identity = await getPortalIdentity(slug);

  if (!identity) {
    return {
      success: false,
      code: "not_signed_in",
      message: "Your session has expired. Sign in again.",
    };
  }

  try {
    await submitPortalCsat(
      identity,
      requestId,
      parsed.data.score,
      parsed.data.comment || undefined,
    );

    revalidatePath(portalRequestPath(slug, requestId));

    return { success: true, data: null };
  } catch (error) {
    return failure(error, "We couldn't save that rating. Try again.");
  }
}

/** Second step of the rating: the optional comment, after the star is in. */
export async function addCsatCommentAction(
  slug: string,
  requestId: string,
  comment: string,
): Promise<PortalResult<null>> {
  const identity = await getPortalIdentity(slug);

  if (!identity) {
    return {
      success: false,
      code: "not_signed_in",
      message: "Your session has expired. Sign in again.",
    };
  }

  try {
    await addPortalCsatComment(identity, requestId, comment);

    revalidatePath(portalRequestPath(slug, requestId));

    return { success: true, data: null };
  } catch (error) {
    return failure(error, "We couldn't save that comment. Try again.");
  }
}
