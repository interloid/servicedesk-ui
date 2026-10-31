import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  formatRelative,
  toFeedItem,
  type NotificationRow,
} from "@/features/notifications/lib/feed";
import type {
  NotificationFailureCode,
  NotificationFeedItem,
  NotificationPrefs,
  NotificationPrefsChange,
} from "@/features/notifications/types/notifications";
import {
  NOTIFICATION_CHANNEL_KEYS,
  NOTIFICATION_EVENT_KEYS,
  defaultNotificationPrefs,
} from "@/features/notifications/types/notifications";

export class NotificationError extends Error {
  readonly status: number;
  readonly code: NotificationFailureCode;

  constructor(
    message: string,
    { status = 400, code = "unknown" as NotificationFailureCode } = {},
  ) {
    super(message);
    this.name = "NotificationError";
    this.status = status;
    this.code = code;
  }
}

type PostgrestFailure = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

function toFailureCode(pgCode: string | undefined): NotificationFailureCode {
  switch (pgCode) {
    case "42501":
      return "action-not-allowed";
    case "23503":
    case "P0001":
      return "not-found";
    default:
      return "unknown";
  }
}

function fail(
  userMessage: string,
  error: PostgrestFailure | null | undefined,
  status = 500,
) {
  if (error) {
    console.error(
      `[notifications] ${userMessage} — ${error.code ?? "?"} ${error.message ?? ""}`.trim(),
      error.details ? `\n  details: ${error.details}` : "",
      error.hint ? `\n  hint: ${error.hint}` : "",
    );
  }

  return new NotificationError(userMessage, {
    status,
    code: toFailureCode(error?.code),
  });
}

type NotificationActor = {
  userId: string;
  tenantId: string;
};

async function requireActor(
  supabase: SupabaseClient,
): Promise<NotificationActor> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new NotificationError("Sign in to do that.", {
      status: 401,
      code: "action-not-allowed",
    });
  }

  const { data: claims } = await supabase.auth.getClaims();
  const tenantId = claims?.claims?.tenant_id as string | undefined;

  if (!tenantId) {
    throw new NotificationError(
      "Your account isn't attached to an organization yet.",
      {
        status: 403,
        code: "action-not-allowed",
      },
    );
  }

  return { userId: user.id, tenantId };
}

function normalizePrefs(value: unknown): NotificationPrefs {
  const defaults = defaultNotificationPrefs();

  if (!value || typeof value !== "object") {
    return defaults;
  }

  const raw = value as {
    email?: Record<string, unknown>;
    in_app?: Record<string, unknown>;
  };

  const pick = (
    channel: Record<string, unknown> | undefined,
    target: NotificationPrefs["email"],
  ): NotificationPrefs["email"] => {
    const keys = Object.keys(target) as (keyof typeof target)[];
    return keys.reduce(
      (acc, key) => {
        const val = channel?.[key];
        acc[key] = typeof val === "boolean" ? val : target[key];
        return acc;
      },
      {} as NotificationPrefs["email"],
    );
  };

  return {
    email: pick(raw.email, defaults.email),
    in_app: pick(raw.in_app, defaults.in_app),
  };
}

function toChannelJson(prefs: NotificationPrefs): Record<string, unknown> {
  return {
    email: { ...prefs.email },
    in_app: { ...prefs.in_app },
  };
}

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireActor(supabase);

  const { data, error } = await supabase
    .from("notification_prefs")
    .select("channel_json")
    .eq("tenant_id", actor.tenantId)
    .eq("user_id", actor.userId)
    .maybeSingle();

  if (error) {
    throw fail("Couldn't load your notification preferences.", error);
  }

  return normalizePrefs(data?.channel_json ?? null);
}

export async function updateNotificationPrefs(
  prefs: NotificationPrefs,
): Promise<NotificationPrefs> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireActor(supabase);

  const normalized = normalizePrefs(toChannelJson(prefs));
  const channelJson = toChannelJson(normalized);

  const { data: before } = await supabase
    .from("notification_prefs")
    .select("channel_json")
    .eq("tenant_id", actor.tenantId)
    .eq("user_id", actor.userId)
    .maybeSingle();
  const previous = normalizePrefs(before?.channel_json ?? null);

  const { error } = await supabase.from("notification_prefs").upsert(
    {
      tenant_id: actor.tenantId,
      user_id: actor.userId,
      channel_json: channelJson,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,user_id" },
  );

  if (error) {
    throw fail("We couldn't save your notification preferences.", error);
  }

  await recordPrefsChanges(supabase, actor, previous, normalized);

  return normalized;
}

const PREFS_AUDIT_ENTITY = "notification_prefs";

/**
 * Feeds the "Settings history" tab. Best effort: the preferences are already
 * saved, so a failed audit row is logged rather than reported as a failed save.
 */
async function recordPrefsChanges(
  supabase: SupabaseClient,
  actor: NotificationActor,
  previous: NotificationPrefs,
  next: NotificationPrefs,
) {
  const changes = NOTIFICATION_CHANNEL_KEYS.flatMap((channel) =>
    NOTIFICATION_EVENT_KEYS.filter(
      (event) => previous[channel][event] !== next[channel][event],
    ).map((event) => ({ channel, event, enabled: next[channel][event] })),
  );

  if (changes.length === 0) {
    return;
  }

  const { error } = await supabase.from("audit_logs").insert({
    tenant_id: actor.tenantId,
    actor_id: actor.userId,
    action: "update",
    entity: PREFS_AUDIT_ENTITY,
    entity_id: actor.userId,
    meta_json: { changes },
  });

  if (error) {
    console.error(
      `[notifications] couldn't record preference history — ${error.code ?? "?"} ${error.message}`,
    );
  }
}

type PrefsAuditRow = {
  id: string;
  meta_json: { changes?: unknown } | null;
  created_at: string;
};

/**
 * The signed-in user's own preference changes, newest first. The
 * audit_logs_select_own_prefs policy lets every user read these rows,
 * whatever their role or plan.
 */
export async function listNotificationPrefsHistory(): Promise<
  NotificationPrefsChange[]
> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireActor(supabase);

  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, meta_json, created_at")
    .eq("tenant_id", actor.tenantId)
    .eq("actor_id", actor.userId)
    .eq("entity", PREFS_AUDIT_ENTITY)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw fail("Couldn't load your settings history.", error);
  }

  return ((data as PrefsAuditRow[] | null) ?? []).flatMap((row) => {
    const changes = Array.isArray(row.meta_json?.changes)
      ? (row.meta_json.changes as Record<string, unknown>[])
      : [];

    return changes.flatMap((change, index) => {
      const channel = NOTIFICATION_CHANNEL_KEYS.find(
        (c) => c === change.channel,
      );
      const event = NOTIFICATION_EVENT_KEYS.find((e) => e === change.event);

      if (!channel || !event || typeof change.enabled !== "boolean") {
        return [];
      }

      return [
        {
          id: `${row.id}:${index}`,
          channel,
          event,
          enabled: change.enabled,
          time: formatRelative(row.created_at),
          createdAt: row.created_at,
        },
      ];
    });
  });
}

export async function listNotifications(): Promise<NotificationFeedItem[]> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireActor(supabase);

  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, payload_json, read_at, created_at")
    .eq("tenant_id", actor.tenantId)
    .eq("user_id", actor.userId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw fail("Couldn't load your notifications.", error);
  }

  return ((data as unknown as NotificationRow[] | null) ?? []).map(toFeedItem);
}

export async function markNotificationRead(
  id: string,
  read = true,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireActor(supabase);

  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: read ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("tenant_id", actor.tenantId)
    .eq("user_id", actor.userId)
    .select("id");

  if (error) {
    throw fail("We couldn't update that notification.", error);
  }

  if (!data || data.length === 0) {
    throw new NotificationError("That notification no longer exists.", {
      status: 404,
      code: "not-found",
    });
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireActor(supabase);

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", actor.tenantId)
    .eq("user_id", actor.userId)
    // `.eq("read_at", null)` sends `read_at=eq.null`, which matches nothing.
    .is("read_at", null);

  if (error) {
    throw fail("We couldn't update your notifications.", error);
  }
}

export async function deleteNotification(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireActor(supabase);

  const { data, error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", id)
    .eq("tenant_id", actor.tenantId)
    .eq("user_id", actor.userId)
    .select("id");

  if (error) {
    throw fail("We couldn't delete that notification.", error);
  }

  if (!data || data.length === 0) {
    throw new NotificationError("That notification no longer exists.", {
      status: 404,
      code: "not-found",
    });
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deletes the given notifications of the signed-in user. The bell passes the
 * ids it shows, so rows hidden by the in-app preferences are left alone.
 */
export async function deleteNotifications(ids: string[]): Promise<void> {
  if (
    ids.length === 0 ||
    ids.length > 200 ||
    !ids.every((id) => typeof id === "string" && UUID_RE.test(id))
  ) {
    throw new NotificationError("Those notifications couldn't be cleared.", {
      status: 400,
      code: "validation",
    });
  }

  const supabase = await createSupabaseServerClient();
  const actor = await requireActor(supabase);

  const { error } = await supabase
    .from("notifications")
    .delete()
    .in("id", ids)
    .eq("tenant_id", actor.tenantId)
    .eq("user_id", actor.userId);

  if (error) {
    throw fail("We couldn't clear your notifications.", error);
  }
}
