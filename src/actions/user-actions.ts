"use server";

import { revalidatePath } from "next/cache";
import {
  profileFormSchema,
  type ProfileFormValues,
} from "@/lib/validations/profile";
import {
  uploadAvatarToSupabase,
  updateUserProfileInSupabase,
} from "@/service/user-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { verifyUserTenantMembership } from "@/features/tenancy/services/tenant-resolver";

export async function updateProfileAction(
  tenantId: string,
  formData: ProfileFormValues,
  file?: File | null,
) {
  const validatedFields = profileFormSchema.safeParse(formData);

  if (!validatedFields.success) {
    return {
      success: false,
      message: "Invalid form input.",
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, message: "Unauthorized." };
    }

    const isMember = await verifyUserTenantMembership(user.id, tenantId);

    if (!isMember) {
      return { success: false, message: "Unauthorized." };
    }

    let avatarUrl = validatedFields.data.avatarUrl;

    if (file && file.size > 0) {
      avatarUrl = await uploadAvatarToSupabase(user.id, tenantId, file);
    }

    const result = await updateUserProfileInSupabase(user.id, tenantId, {
      ...validatedFields.data,
      avatarUrl,
    });

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
