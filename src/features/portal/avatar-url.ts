import "server-only";

import { env } from "@/config/env";
import { AVATAR_BUCKET } from "@/features/portal/portal";

/**
 * Where a customer's photos live in the avatars bucket: `<tenant>/<user>`, the
 * same shape the team app writes (see uploadAvatarToSupabase). The tenant id
 * leads so the bucket's own storage policies -- which match the first folder
 * against the tenant claim -- apply to a customer's photos as well.
 */
export function customerAvatarFolder(tenantId: string, userId: string): string {
  return `${tenantId}/${userId}`;
}

/**
 * The customer's photo, read off their `users` row (see updatePortalProfile
 * for why it lives there).
 *
 * `users_update` admits `id = auth.uid()`, so a customer can write this column
 * themselves through the API. Only a URL pointing into this customer's own
 * folder of our avatars bucket is used; anything else falls back to initials.
 *
 * Shared by the portal and the team's Customers pages. On the team side it
 * matters more, not less: an unchecked URL there would have every agent who
 * opens the list fetch an image from wherever a customer pointed it.
 */
export function trustedCustomerAvatarUrl(
  tenantId: string,
  userId: string,
  avatarUrl: string | null,
): string | null {
  if (!avatarUrl) {
    return null;
  }

  const allowed = `${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/${AVATAR_BUCKET}/${customerAvatarFolder(tenantId, userId)}/`;

  return avatarUrl.startsWith(allowed) ? avatarUrl : null;
}
