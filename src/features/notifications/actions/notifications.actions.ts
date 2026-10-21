"use server";

import { revalidatePath } from "next/cache";

import { getSessionTenantSlug } from "@/features/tenancy/services/tenant-resolver";
import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";

import type {
  NotificationActionResult,
  NotificationFeedItem,
  NotificationPrefs,
} from "@/features/notifications/types/notifications";
import {
  NotificationError,
  deleteNotification,
  getNotificationPrefs,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationPrefs,
} from "@/features/notifications/services/notifications.service";

function toFailure<T>(
  error: unknown,
  fallback: string,
  context: string,
): NotificationActionResult<T> {
  if (error instanceof NotificationError) {
    return { ok: false, failureCode: error.code, message: error.message };
  }

  console.error(`[notifications] ${context} failed`, error);

  return { ok: false, failureCode: "unknown", message: fallback };
}

/**
 * Needs the tenant prefix: "/settings/notifications" matches no route in this
 * app, so the saved preferences never replaced the ones on screen.
 */
async function revalidateNotifications() {
  const slug = await getSessionTenantSlug();

  if (!slug) {
    return;
  }

  revalidatePath(tenantPath(slug, TENANT_ROUTES.SETTINGS.NOTIFICATIONS));
}

export async function updateNotificationPrefsAction(
  prefs: NotificationPrefs,
): Promise<NotificationActionResult<NotificationPrefs>> {
  try {
    const saved = await updateNotificationPrefs(prefs);
    await revalidateNotifications();
    return { ok: true, data: saved };
  } catch (error) {
    return toFailure(
      error,
      "We couldn't save your notification preferences.",
      "updateNotificationPrefsAction",
    );
  }
}

export async function markNotificationReadAction(
  id: string,
  read = true,
): Promise<NotificationActionResult> {
  try {
    await markNotificationRead(id, read);
    await revalidateNotifications();
    return { ok: true };
  } catch (error) {
    return toFailure(
      error,
      "We couldn't update that notification.",
      "markNotificationReadAction",
    );
  }
}

export async function deleteNotificationAction(
  id: string,
): Promise<NotificationActionResult> {
  try {
    await deleteNotification(id);
    await revalidateNotifications();
    return { ok: true };
  } catch (error) {
    return toFailure(
      error,
      "We couldn't delete that notification.",
      "deleteNotificationAction",
    );
  }
}

export async function markAllNotificationsReadAction(): Promise<NotificationActionResult> {
  try {
    await markAllNotificationsRead();
    await revalidateNotifications();
    return { ok: true };
  } catch (error) {
    return toFailure(
      error,
      "We couldn't update your notifications.",
      "markAllNotificationsReadAction",
    );
  }
}

export async function loadNotificationsAction(): Promise<
  NotificationActionResult<{
    prefs: NotificationPrefs;
    notifications: NotificationFeedItem[];
  }>
> {
  try {
    const [prefs, notifications] = await Promise.all([
      getNotificationPrefs(),
      listNotifications(),
    ]);
    return { ok: true, data: { prefs, notifications } };
  } catch (error) {
    return toFailure(
      error,
      "We couldn't load your notifications.",
      "loadNotificationsAction",
    );
  }
}
