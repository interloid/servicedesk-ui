import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTenantIdBySlug } from "@/features/tenancy/services/tenant-resolver";
import {
  NotificationType,
  NotificationPayload,
  UiNotification,
  toUiNotification,
} from "@/lib/notifications-shared";

export type { NotificationType, NotificationPayload, UiNotification };

/**
 * Insert a single notification row for a user, bypassing RLS (service role).
 */
export async function createNotification(params: {
  tenantId: string;
  userId: string;
  type: NotificationType;
  payload?: NotificationPayload;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("notifications").insert({
    tenant_id: params.tenantId,
    user_id: params.userId,
    type: params.type,
    payload_json: (params.payload || {}) as Record<string, unknown>,
  });

  if (error) {
    console.error("[notifications] create failed:", error.message);
  }
}

/**
 * Insert notifications for a set of agents (or any user ids) belonging to a tenant.
 */

/**
 * Fetch notifications for the current user within the given tenant (server-side).
 */
export async function fetchCurrentUserNotifications(
  tenant: string,
): Promise<UiNotification[]> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !tenantId) return [];

  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, payload_json, read_at, created_at")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[notifications] fetch failed:", error.message);
    return [];
  }

  return (data || []).map((n) =>
    toUiNotification(n as Parameters<typeof toUiNotification>[0]),
  );
}

export async function markAllNotificationsRead(tenant: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !tenantId) return;

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .is("read_at", null);

  if (error) {
    console.error("[notifications] mark all read failed:", error.message);
  }
}

export async function markNotificationRead(
  notificationId: string,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId);

  if (error) {
    console.error("[notifications] mark read failed:", error.message);
  }
}
