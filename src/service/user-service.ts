import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AVATAR_BUCKET, avatarError } from "@/features/portal/portal";
import type { ProfileFormValues } from "@/lib/validations/profile";

/** Every staff photo lives under `<tenant id>/<user id>/`, like the portal's. */
function staffAvatarFolder(userId: string, tenantId: string): string {
  return `${tenantId}/${userId}`;
}

/**
 * Authorise one profile-photo upload. The browser sends the bytes straight to
 * Storage with the token: a Server Action body is capped at 1 MB, well under
 * the 5 MB photos the bucket accepts. Same pattern as the portal's
 * preparePortalAvatarUpload.
 */
export async function prepareAvatarUpload(
  userId: string,
  tenantId: string,
  file: { size: number; type: string },
): Promise<{ path: string; token: string }> {
  const problem = avatarError(file);

  if (problem) {
    throw new Error(problem);
  }

  const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "img";
  const path = `${staffAvatarFolder(userId, tenantId)}/${Date.now()}.${extension}`;

  const { data, error } = await createSupabaseAdminClient()
    .storage.from(AVATAR_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error(
      "[profile] could not authorise an avatar upload:",
      error?.message ?? "no token returned",
    );
    throw new Error("We couldn't start that upload. Try again in a moment.");
  }

  return { path, token: data.token };
}

/**
 * Save the staff profile: the name, and optionally a photo already uploaded to
 * `avatarPath`. Email is never written here -- it follows the auth account --
 * and the photo URL is built on the server from a path in this user's own
 * folder, so a caller cannot point it at an outside server.
 */
export async function updateUserProfileInSupabase(
  userId: string,
  tenantId: string,
  data: Pick<ProfileFormValues, "fullName">,
  avatarPath?: string | null,
) {
  const folder = staffAvatarFolder(userId, tenantId);

  // Checked before anything is written, so a bad path cannot leave the name
  // saved and the request reported as failed.
  if (
    avatarPath &&
    (!avatarPath.startsWith(`${folder}/`) || avatarPath.includes(".."))
  ) {
    throw new Error("That photo upload wasn't valid.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: updatedUser, error: userError } = await supabase
    .from("users")
    .update({
      full_name: data.fullName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select()
    .single();

  if (userError) {
    throw new Error(`Failed to update user profile: ${userError.message}`);
  }

  if (!avatarPath) {
    return updatedUser;
  }

  // avatar_url is refused from the client roles (guard_users_profile_columns),
  // so the server writes it with the service role.
  const admin = createSupabaseAdminClient();
  const {
    data: { publicUrl },
  } = admin.storage.from(AVATAR_BUCKET).getPublicUrl(avatarPath);

  const { data: withPhoto, error: photoError } = await admin
    .from("users")
    .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select()
    .single();

  if (photoError) {
    throw new Error(`Failed to update profile photo: ${photoError.message}`);
  }

  return withPhoto;
}
