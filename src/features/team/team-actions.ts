"use server";

import { revalidatePath } from "next/cache";

import { getSessionTenantSlug } from "@/features/tenancy/services/tenant-resolver";
import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";

import {
  changeMemberRoleSchema,
  changeMemberStatusSchema,
  inviteMemberSchema,
  removeMemberSchema,
  resendInviteSchema,
  transferOwnershipSchema,
} from "@/features/team/schemas/team";
import type { TeamActionResult } from "@/features/team/types/team";
import {
  changeMemberRole,
  changeMemberStatus,
  inviteMember,
  removeMember,
  resendInvite,
  TeamError,
  transferOwnership,
} from "@/features/team/services/team.service";

function toFailure(
  error: unknown,
  fallback: string,
  context: string,
): TeamActionResult {
  if (error instanceof TeamError) {
    return { ok: false, failureCode: error.code, message: error.message };
  }

  console.error(`[team] ${context} failed`, error);

  return { ok: false, failureCode: "unknown", message: fallback };
}

/**
 * Every route lives under `/[tenantSlug]/`, so a bare "/settings/team" matches
 * nothing and revalidates nothing. Invites and role changes were saving fine
 * and then leaving the stale list on screen, which reads as a failed save.
 */
async function revalidateTeam() {
  const slug = await getSessionTenantSlug();

  if (!slug) {
    return;
  }

  revalidatePath(tenantPath(slug, TENANT_ROUTES.SETTINGS.TEAM));
}

export async function inviteMemberAction(
  values: unknown,
): Promise<TeamActionResult> {
  const parsed = inviteMemberSchema.safeParse(values);

  if (!parsed.success) {
    return {
      ok: false,
      failureCode: "validation",
      message: "Check the highlighted fields and try again.",
    };
  }

  try {
    await inviteMember(parsed.data);
    await revalidateTeam();
    return { ok: true };
  } catch (error) {
    return toFailure(
      error,
      "We couldn't send that invite. Try again in a moment.",
      "inviteMemberAction",
    );
  }
}

export async function resendInviteAction(
  values: unknown,
): Promise<TeamActionResult> {
  const parsed = resendInviteSchema.safeParse(values);

  if (!parsed.success) {
    return {
      ok: false,
      failureCode: "validation",
      message: "That isn't an invitation we can resend.",
    };
  }

  try {
    await resendInvite(parsed.data);
    await revalidateTeam();
    return { ok: true };
  } catch (error) {
    return toFailure(
      error,
      "We couldn't resend that invite. Try again in a moment.",
      "resendInviteAction",
    );
  }
}

export async function changeMemberRoleAction(
  values: unknown,
): Promise<TeamActionResult> {
  const parsed = changeMemberRoleSchema.safeParse(values);

  if (!parsed.success) {
    return {
      ok: false,
      failureCode: "validation",
      message: "That isn't a role change we can apply.",
    };
  }

  try {
    await changeMemberRole(parsed.data);
    await revalidateTeam();
    return { ok: true };
  } catch (error) {
    return toFailure(
      error,
      "We couldn't change that person's role. Try again in a moment.",
      "changeMemberRoleAction",
    );
  }
}

export async function changeMemberStatusAction(
  values: unknown,
): Promise<TeamActionResult> {
  const parsed = changeMemberStatusSchema.safeParse(values);

  if (!parsed.success) {
    return {
      ok: false,
      failureCode: "validation",
      message: "That isn't a status change we can apply.",
    };
  }

  try {
    await changeMemberStatus(parsed.data);
    await revalidateTeam();
    return { ok: true };
  } catch (error) {
    return toFailure(
      error,
      "We couldn't update that member. Try again in a moment.",
      "changeMemberStatusAction",
    );
  }
}

export async function removeMemberAction(
  values: unknown,
): Promise<TeamActionResult> {
  const parsed = removeMemberSchema.safeParse(values);

  if (!parsed.success) {
    return {
      ok: false,
      failureCode: "validation",
      message: "That isn't a member we can remove.",
    };
  }

  try {
    await removeMember(parsed.data);
    await revalidateTeam();
    return { ok: true };
  } catch (error) {
    return toFailure(
      error,
      "We couldn't remove that member. Try again in a moment.",
      "removeMemberAction",
    );
  }
}

export async function transferOwnershipAction(
  values: unknown,
): Promise<TeamActionResult> {
  const parsed = transferOwnershipSchema.safeParse(values);

  if (!parsed.success) {
    return {
      ok: false,
      failureCode: "validation",
      message: "Pick who should own the workspace.",
    };
  }

  try {
    await transferOwnership(parsed.data);
    await revalidateTeam();
    return { ok: true };
  } catch (error) {
    return toFailure(
      error,
      "We couldn't transfer ownership. Try again in a moment.",
      "transferOwnershipAction",
    );
  }
}
