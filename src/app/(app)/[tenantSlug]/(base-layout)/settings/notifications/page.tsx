import type { Metadata } from "next";

import {
  getNotificationPrefs,
  listNotificationPrefsHistory,
  listNotifications,
} from "@/features/notifications/services/notifications.service";
import NotificationsView from "@/features/notifications/components/notifications-view";
import type { NotificationsData } from "@/features/notifications/types/notifications";

export const metadata: Metadata = {
  title: "Notifications",
  description: "Manage notification preferences and view workspace activity.",
};

export default async function NotificationsPage() {
  const [prefs, notifications, history] = await Promise.all([
    getNotificationPrefs(),
    listNotifications(),
    // Only the history tab depends on it, so a failure there shouldn't take
    // the whole page down.
    listNotificationPrefsHistory().catch(() => []),
  ]);

  const data: NotificationsData = { prefs, notifications, history };

  return (
    <main className="w-full">
      <NotificationsView data={data} />
    </main>
  );
}
