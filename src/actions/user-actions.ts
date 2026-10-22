"use server";

import { revalidatePath } from "next/cache";
import {
  profileFormSchema,
  type ProfileFormValues,
} from "@/lib/validations/profile";
import {
  prepareAvatarUpload,
  updateUserProfileInSupabase,
} from "@/service/user-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { verifyUserTenantMembership } from "@/features/tenancy/services/tenant-resolver";

/** The signed-in staff member, if they belong to `tenantId`. */
async function currentMember(tenantId: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return null;
  }

  const isMember = await verifyUserTenantMembership(user.id, tenantId);

  return isMember ? user : null;
}

/**
 * Step one of a photo change: a single-use token to upload it with. The
 * browser uploads straight to Storage, so the photo never goes through the
 * 1 MB Server Action body limit.
 */
export async function prepareProfileAvatarUploadAction(
  tenantId: string,
  file: { size: number; type: string },
): Promise<
  | { success: true; data: { path: string; token: string } }
  | { success: false; message: string }
> {
  if (typeof file?.size !== "number" || typeof file?.type !== "string") {
    return { success: false, message: "Invalid file." };
  }

  try {
    const user = await currentMember(tenantId);

    if (!user) {
      return { success: false, message: "Unauthorized." };
    }

    return {
      success: true,
      data: await prepareAvatarUpload(user.id, tenantId, {
        size: file.size,
        type: file.type,
      }),
    };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "We couldn't start that upload. Try again.",
    };
  }
}

/** Save the profile; `avatarPath` is set only when a new photo was uploaded. */
export async function updateProfileAction(
  tenantId: string,
  formData: ProfileFormValues,
  avatarPath?: string | null,
) {
  const validatedFields = profileFormSchema.safeParse(formData);

  if (!validatedFields.success) {
    return {
      success: false,
      message: "Invalid form input.",
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  if (avatarPath != null && typeof avatarPath !== "string") {
    return { success: false, message: "That photo upload wasn't valid." };
  }

  try {
    const user = await currentMember(tenantId);

    if (!user) {
      return { success: false, message: "Unauthorized." };
    }

    const result = await updateUserProfileInSupabase(
      user.id,
      tenantId,
      { fullName: validatedFields.data.fullName },
      avatarPath,
    );

    revalidatePath("/", "layout");

    return {
      success: true,
      message: "Profile updated successfully.",
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to update profile.",
    };
  }
}
