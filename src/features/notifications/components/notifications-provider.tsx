"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { createSupabaseClient } from "@/lib/supabase/client";
import { subscribeWithAuth } from "@/lib/supabase/realtime";
import {
  isShownInApp,
  toFeedItem,
  type NotificationRow,
} from "@/features/notifications/lib/feed";
import type {
  NotificationFeedItem,
  NotificationPrefs,
} from "@/features/notifications/types/notifications";
import {
  clearNotificationsAction,
  deleteNotificationAction,
  loadNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  updateNotificationPrefsAction,
} from "@/features/notifications/actions/notifications.actions";

interface NotificationsContextValue {
  /** Null until the first load finishes. */
  prefs: NotificationPrefs | null;
  notifications: NotificationFeedItem[] | null;
  /** Server-rendered data from a page, newer than whatever is held. */
  hydrate: (data: {
    prefs: NotificationPrefs;
    notifications: NotificationFeedItem[];
  }) => void;
  savePrefs: (next: NotificationPrefs) => Promise<boolean>;
  setRead: (id: string, read: boolean) => Promise<boolean>;
  markAllRead: () => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  /** Deletes these notifications, e.g. everything the bell shows. */
  clear: (ids: string[]) => Promise<boolean>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(
  null,
);

export function useNotifications(): NotificationsContextValue {
  const value = useContext(NotificationsContext);
  if (!value) {
    throw new Error(
      "useNotifications must be used inside NotificationsProvider",
    );
  }
  return value;
}

function sortNewestFirst(list: NotificationFeedItem[]) {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * One feed for the header bell and the notifications page, kept live over
 * realtime. RLS on `notifications` only delivers the recipient's own rows.
 */
export function NotificationsProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [notifications, setNotifications] = useState<
    NotificationFeedItem[] | null
  >(null);

  // Read inside the realtime callback, which is bound once per user.
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  const hydrate = useCallback<NotificationsContextValue["hydrate"]>((data) => {
    setPrefs(data.prefs);
    setNotifications(data.notifications);
  }, []);

  const reload = useCallback(async () => {
    const res = await loadNotificationsAction();
    if (res.ok && res.data) hydrate(res.data);
  }, [hydrate]);

  useEffect(() => {
    const supabase = createSupabaseClient();
    const filter = `user_id=eq.${userId}`;

    const channel = supabase
      .channel(`realtime-notifications-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter },
        (payload) => {
          const item = toFeedItem(payload.new as NotificationRow);
          setNotifications((prev) =>
            prev && !prev.some((n) => n.id === item.id)
              ? sortNewestFirst([item, ...prev])
              : prev,
          );
          if (isShownInApp(item, prefsRef.current)) {
            toast(item.title, { description: item.subtitle || undefined });
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter },
        (payload) => {
          const item = toFeedItem(payload.new as NotificationRow);
          setNotifications((prev) =>
            prev
              ? sortNewestFirst(
                  prev.some((n) => n.id === item.id)
                    ? prev.map((n) => (n.id === item.id ? item : n))
                    : [item, ...prev],
                )
              : prev,
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "notifications", filter },
        (payload) => {
          const old = payload.old as { id?: string };
          setNotifications((prev) =>
            prev ? prev.filter((n) => n.id !== old.id) : prev,
          );
        },
      );

    // Realtime doesn't replay what was missed while the socket was down,
    // so every (re)subscribe loads the feed again.
    const unsubscribe = subscribeWithAuth(supabase, channel, (status) => {
      if (status === "SUBSCRIBED") void reload();
    });

    return () => {
      unsubscribe();
    };
  }, [userId, reload]);

  const savePrefs = useCallback(async (next: NotificationPrefs) => {
    const prev = prefsRef.current;
    setPrefs(next);
    const res = await updateNotificationPrefsAction(next);
    if (!res.ok) {
      toast.error(res.message ?? "We couldn't save your preferences.");
      setPrefs(prev);
      return false;
    }
    return true;
  }, []);

  // Optimistic list changes, rolled back to the snapshot when the save fails.
  const mutate = useCallback(
    async (
      apply: (list: NotificationFeedItem[]) => NotificationFeedItem[],
      run: () => Promise<{ ok: boolean; message?: string }>,
      fallback: string,
    ) => {
      let snapshot: NotificationFeedItem[] | null = null;
      setNotifications((list) => {
        snapshot = list;
        return list ? apply(list) : list;
      });
      const res = await run();
      if (!res.ok) {
        toast.error(res.message ?? fallback);
        setNotifications(snapshot);
        return false;
      }
      return true;
    },
    [],
  );

  const setRead = useCallback(
    (id: string, read: boolean) =>
      mutate(
        (list) => list.map((n) => (n.id === id ? { ...n, unread: !read } : n)),
        () => markNotificationReadAction(id, read),
        "We couldn't update that notification.",
      ),
    [mutate],
  );

  const markAllRead = useCallback(
    () =>
      mutate(
        (list) => list.map((n) => ({ ...n, unread: false })),
        () => markAllNotificationsReadAction(),
        "We couldn't update your notifications.",
      ),
    [mutate],
  );

  const remove = useCallback(
    (id: string) =>
      mutate(
        (list) => list.filter((n) => n.id !== id),
        () => deleteNotificationAction(id),
        "We couldn't delete that notification.",
      ),
    [mutate],
  );

  const clear = useCallback(
    (ids: string[]) => {
      const gone = new Set(ids);
      return mutate(
        (list) => list.filter((n) => !gone.has(n.id)),
        () => clearNotificationsAction(ids),
        "We couldn't clear your notifications.",
      );
    },
    [mutate],
  );

  const value = useMemo<NotificationsContextValue>(
    () => ({
      prefs,
      notifications,
      hydrate,
      savePrefs,
      setRead,
      markAllRead,
      remove,
      clear,
    }),
    [
      prefs,
      notifications,
      hydrate,
      savePrefs,
      setRead,
      markAllRead,
      remove,
      clear,
    ],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}
