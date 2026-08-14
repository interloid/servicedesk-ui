"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RegisterInput } from "./schemas/onboarding.schema";
import { registerTenant } from "./services/onboarding.service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";


export async function registerOnboardingAction(payload: RegisterInput) {
  try {
    const result = await registerTenant(payload);
    return { success: true, data: result.data };
  } catch (error: any) {
    console.error("[Onboarding Action Error]:", error);
    return {
      success: false,
      error: error?.message || "An unexpected error occurred during setup.",
    };
  }
}

export async function checkSlugAvailabilityAction(slug: string): Promise<{ available: boolean; error?: string }> {
  console.log("🚀 ~ checkSlugAvailabilityAction ~ slug:", slug)
  try {
    const supabase = await createSupabaseAdminClient();
    
    const { data, error } = await supabase
      .from("tenants")
      .select("id")
      .eq("slug", slug.toLowerCase().trim())
      .maybeSingle();
    console.log("🚀 ~ checkSlugAvailabilityAction ~ data:", data)

    if (error) {
      console.error("Slug check error:", error.message);
      return { available: true };
    }

    return { available: !data };
  } catch (err: any) {
    console.error("Server slug check failed:", err);
    return { available: true };
  }
}


export async function checkEmailTenant(email: string): Promise<{ exists: boolean; tenant?: any }> {
  const cleanEmail = email.trim().toLowerCase();
  console.log("🚀 ~ checkEmailTenant ~ cleanEmail:", cleanEmail)
const supabase = await createSupabaseAdminClient();  

  if (!cleanEmail) {
    return { exists: false };
  }

  // Exact email check on the tenants table
  const { data, error } = await supabase
    .from("users")
    .select("email")
    .eq("email", cleanEmail)
    .maybeSingle();
  console.log("🚀 ~ checkEmailTenant ~ data:", data)

  if (error || !data) {
    return { exists: false };
  }

  return {
    exists: true,
    tenant: data,
  };
}