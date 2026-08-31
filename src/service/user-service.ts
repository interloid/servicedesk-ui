import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileFormValues } from "@/lib/validations/profile";

export async function uploadAvatarToSupabase(
  userId: string,
  tenantId: string,
  file: File,
): Promise<string> {
  const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

  if (file.size > MAX_AVATAR_SIZE) {
    throw new Error("Avatar image must be 5 MB or smaller.");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Please upload a valid image file.");
  }

  const supabase = await createSupabaseServerClient();

  const fileExt = file.name.split(".").pop();
  const filePath = `${tenantId}/${userId}/${Date.now()}.${fileExt}`;

  const fileBuffer = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(filePath, fileBuffer, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Avatar upload failed: ${uploadError.message}`);
  }

  const { data: publicUrlData } = supabase.storage
    .from("avatars")
    .getPublicUrl(filePath);

  return publicUrlData.publicUrl;
}

export async function updateUserProfileInSupabase(
  userId: string,
  tenantId: string,
  data: ProfileFormValues,
) {
  const supabase = await createSupabaseServerClient();

  const { data: updatedUser, error: userError } = await supabase
    .from("users")
    .update({
      full_name: data.fullName,
      email: data.email,
      avatar_url: data.avatarUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select()
    .single();

  if (userError) {
    throw new Error(`Failed to update user profile: ${userError.message}`);
  }

  return updatedUser;
}
