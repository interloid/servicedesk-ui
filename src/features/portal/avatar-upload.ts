import { AVATAR_BUCKET } from "@/features/portal/portal";
import { createSupabaseClient } from "@/lib/supabase/client";

/**
 * Put a profile photo in the avatars bucket, from the browser, with the
 * single-use token preparePortalAvatarUpload minted. Same reason as
 * uploadToTargets: a Server Action body is capped at 1 MB.
 */
export async function uploadAvatar(
  target: { path: string; token: string },
  file: File,
): Promise<void> {
  const { error } = await createSupabaseClient()
    .storage.from(AVATAR_BUCKET)
    .uploadToSignedUrl(target.path, target.token, file, {
      contentType: file.type,
    });

  if (error) {
    throw new Error("We couldn't upload that photo. Try again.");
  }
}
