import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  NotificationType,
  NotificationPayload,
  UiNotification,
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
 * Insert one notification per recipient in a single request, bypassing RLS
 * (service role). The caller decides who may receive it.
 */
export async function createNotifications(
  rows: {
    tenantId: string;
    userId: string;
    type: NotificationType;
    payload?: NotificationPayload;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("notifications").insert(
    rows.map((r) => ({
      tenant_id: r.tenantId,
      user_id: r.userId,
      type: r.type,
      payload_json: (r.payload || {}) as Record<string, unknown>,
    })),
  );

  if (error) {
    console.error("[notifications] batch create failed:", error.message);
  }
}
