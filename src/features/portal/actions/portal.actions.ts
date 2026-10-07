"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

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
  portalAvatarFileSchema,
  portalAvatarPathSchema,
  portalDiscardPathsSchema,
  portalFileDescriptorsSchema,
  portalUploadedFilesSchema,
  portalReplySchema,
  portalSetPasswordSchema,
  type PortalAvatarFileValues,
  type PortalEmailValues,
  type PortalFileDescriptors,
  type PortalGuestRequestValues,
  type PortalPasswordLoginValues,
  type PortalProfileValues,
  type PortalCsatValues,
  type PortalReplyValues,
  type PortalRequestValues,
  type PortalSetPasswordValues,
} from "@/features/portal/schemas/portal.schema";
import {
  completePortalOnboarding,
  createPortalRequest,
  createPortalStagingTargets,
  createPortalUploadTargets,
  discardPortalUploads,
  getPortalIdentity,
  portalPasswordSignIn,
  PortalError,
  preparePortalAvatarUpload,
  updatePortalProfile,
  portalSignOut,
  postPortalReply,
  reopenPortalRequest,
  isTeamEmail,
  markPortalWelcomeShown,
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
  // Changing a password on an existing session. Separate from sign-in attempts
  // so one cannot use up the other.
  setPassword: { limit: 10, windowMs: 10 * MINUTE },
  guestRequest: { limit: 3, windowMs: 15 * MINUTE },
  // Counted per file (guard's `cost`), not per call: one call can ask for up to
  // MAX_ATTACHMENTS_PER_MESSAGE targets. Roughly a dozen replies' worth.
  upload: { limit: 60, windowMs: 10 * MINUTE },
} as const;

type Limit = keyof typeof LIMITS;

/** `cost` is how many units this call spends -- the number of files, for uploads. */
async function guard(action: Limit, cost = 1): Promise<PortalFailure | null> {
  const key = `portal:${action}:${await clientKey()}`;

  let allowed = true;
  let retryAfterMs = 0;

  // The limiter counts one hit per call, so a call that costs n is n hits.
  for (let spent = 0; spent < Math.max(1, cost); spent += 1) {
    ({ allowed, retryAfterMs } = rateLimit(key, LIMITS[action]));

    if (!allowed) break;
  }

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
    // zod leaves a key with `undefined` for a field that passed; dropped here
    // rather than cast away, so PortalFailure's type is true of what is sent.
    fieldErrors: Object.fromEntries(
      Object.entries(fieldErrors).filter(
        (entry): entry is [string, string[]] => entry[1] !== undefined,
      ),
    ),
  };
}

/** The first problem with a non-form input, as a plain validation failure. */
function invalidInput(error: z.ZodError): PortalFailure {
  return {
    success: false,
    code: "validation",
    message: error.issues[0]?.message ?? "That file could not be attached.",
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

    // The password page's banner says how they signed in; this is the one
    // route that is not the email link.
    const redirectTo =
      step === "password"
        ? `${stepPath(slug, step)}?via=password`
        : stepPath(slug, step);

    return { success: true, data: { redirectTo } };
  } catch (error) {
    return failure(error, "We couldn't sign you in. Try again in a moment.");
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/**
 * Step one of a photo change: a single-use token to upload it with.
 *
 * The claimed size and type are checked here, before a token exists, because
 * the token is what the browser uploads against and the bytes have not moved yet.
 * A claim is still only a claim -- preparePortalAvatarUpload reads the stored
 * object's own size and type back afterwards -- but without this the action would
 * mint an upload token for any Content-Type a caller felt like sending, and the
 * bucket's MIME allow-list would be the only thing left between that and a file
 * served from the app's own origin.
 */
export async function prepareAvatarUploadAction(
  slug: string,
  file: PortalAvatarFileValues,
): Promise<PortalResult<{ path: string; token: string }>> {
  const parsed = portalAvatarFileSchema.safeParse(file);

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
    return {
      success: true,
      data: await preparePortalAvatarUpload(identity, parsed.data),
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

  const photo = portalAvatarPathSchema.safeParse(avatarPath);

  if (!photo.success) {
    return invalidInput(photo.error);
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
      avatarPath: photo.data,
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

  const limited = await guard("setPassword");
  if (limited) return limited;

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

/**
 * Spend the welcome wizard once it is actually on screen.
 *
 * Called by the wizard from an effect, so it runs only in a browser that has
 * mounted the page -- never for a prefetch or a replayed server render, which
 * is what stamping from the page itself got wrong. The stamp keeps the wizard
 * to one showing per customer: closing the tab mid-tour, or signing in again
 * with a second link, goes straight to the requests next time.
 *
 * Fire-and-forget from the client's point of view: failing to remember costs
 * one more viewing, so nothing is reported back.
 */
export async function markWelcomeShownAction(slug: string): Promise<void> {
  const identity = await getPortalIdentity(slug);

  if (!identity || identity.customer.onboarded) {
    return;
  }

  await markPortalWelcomeShown(slug, identity.userId);
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
    // markWelcomeShownAction stamps this as the wizard mounts, so by the time
    // its buttons call here it is normally already done -- nothing to write.
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
  files: PortalFileDescriptors,
): Promise<PortalResult<{ targets: PortalUploadTarget[] }>> {
  const parsedFiles = portalFileDescriptorsSchema.safeParse(files);

  if (!parsedFiles.success) {
    return invalidInput(parsedFiles.error);
  }

  const limited = await guard("upload", parsedFiles.data.length);
  if (limited) return limited;

  try {
    const targets = await createPortalStagingTargets(slug, parsedFiles.data);

    return { success: true, data: { targets } };
  } catch (error) {
    return failure(error, "We couldn't start that upload. Try again.");
  }
}

/**
 * Give back uploads that were never filed -- see discardPortalUploads for what
 * it will and will not delete. Called by prepareAndUpload when some of a set of
 * uploads failed, and by the forms when the request or reply was then refused.
 * Returns nothing: the caller is already reporting a failure of its own.
 */
export async function discardUploadsAction(
  slug: string,
  paths: string[],
  requestId?: string,
): Promise<void> {
  const parsed = portalDiscardPathsSchema.safeParse(paths);

  if (!parsed.success || parsed.data.length === 0) {
    return;
  }

  const identity = requestId ? await getPortalIdentity(slug) : null;

  try {
    await discardPortalUploads({
      slug,
      paths: parsed.data,
      identity,
      requestId,
    });
  } catch (error) {
    console.error("[portal] discard failed:", error);
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

  const files = portalUploadedFilesSchema.safeParse(uploads);

  if (!files.success) {
    return invalidInput(files.error);
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
      uploads: files.data,
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

  const files = portalUploadedFilesSchema.safeParse(uploads);

  if (!files.success) {
    return invalidInput(files.error);
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
      uploads: files.data,
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
  files: PortalFileDescriptors,
): Promise<PortalResult<{ targets: PortalUploadTarget[] }>> {
  const parsedFiles = portalFileDescriptorsSchema.safeParse(files);

  if (!parsedFiles.success) {
    return invalidInput(parsedFiles.error);
  }

  const identity = await getPortalIdentity(slug);

  if (!identity) {
    return {
      success: false,
      code: "not_signed_in",
      message: "Your session has expired. Sign in again.",
    };
  }

  const limited = await guard("upload", parsedFiles.data.length);
  if (limited) return limited;

  try {
    const targets = await createPortalUploadTargets(
      identity,
      requestId,
      parsedFiles.data,
    );

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

  const files = portalUploadedFilesSchema.safeParse(uploads);

  if (!files.success) {
    return invalidInput(files.error);
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
    await postPortalReply(identity, requestId, parsed.data.body, files.data);

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
