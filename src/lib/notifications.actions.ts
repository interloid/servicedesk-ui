"use server";

import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications.service";

export async function markAllNotificationsReadAction(tenant: string) {
  try {
    await markAllNotificationsRead(tenant);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to mark as read.",
    };
  }
}

export async function markNotificationReadAction(notificationId: string) {
  try {
    await markNotificationRead(notificationId);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update.",
    };
  }
}
