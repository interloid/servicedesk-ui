"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AtSign,
  Bell,
  BellOff,
  Calendar,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Filter,
  Mail,
  MailOpen,
  MessageSquare,
  MoreVertical,
  Reply,
  Search,
  Settings2,
  Smartphone,
  Ticket,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Pagination } from "@/components/shared/pagination";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import type {
  NotificationChannelKey,
  NotificationEventKey,
  NotificationFeedItem,
  NotificationFeedType,
  NotificationPrefs,
  NotificationsData,
} from "@/features/notifications/types/notifications";
import { useNotifications } from "@/features/notifications/components/notifications-provider";

interface PreferenceRow {
  id: NotificationEventKey;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: keyof typeof TONES;
}

const PREFERENCE_ROWS: PreferenceRow[] = [
  {
    id: "assigned",
    label: "A ticket is assigned to me",
    description: "Get notified when a ticket is assigned to you.",
    icon: Mail,
    tone: "teal",
  },
  {
    id: "replies",
    label: "A customer replies",
    description: "Get notified when a customer replies to a ticket.",
    icon: Reply,
    tone: "blue",
  },
  {
    id: "sla",
    label: "An SLA is about to breach",
    description: "Get notified before an SLA is about to breach.",
    icon: TriangleAlert,
    tone: "amber",
  },
  {
    id: "mention",
    label: "I'm @mentioned in a note",
    description: "Get notified when someone mentions you in a ticket note.",
    icon: AtSign,
    tone: "violet",
  },
];

const CHANNELS: {
  id: NotificationChannelKey;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "email", label: "Email", icon: Mail },
  { id: "in_app", label: "In-app", icon: Smartphone },
];

const TYPE_FILTERS: { id: NotificationFeedType | "all"; label: string }[] = [
  { id: "all", label: "All types" },
  { id: "ticket", label: "Tickets" },
  { id: "sla", label: "SLA" },
  { id: "reply", label: "Replies & mentions" },
  { id: "payment", label: "Billing" },
  { id: "system", label: "System" },
];

const DATE_FILTERS = [
  { id: "all", label: "All time", days: null },
  { id: "today", label: "Today", days: 0 },
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
] as const;

type DateFilter = (typeof DATE_FILTERS)[number]["id"];
type Tab = "all" | "unread" | "history";

const PAGE_SIZE = 8;

const TONES = {
  red: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  blue: "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
  teal: "bg-primary/10 text-primary",
  violet:
    "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
  slate: "bg-muted text-muted-foreground",
} as const;

/**
 * Breaches are red and warnings amber; first-response clocks get the mail
 * icon in blue so they read apart from resolution clocks at a glance.
 */
function notificationIcon(item: NotificationFeedItem): {
  icon: LucideIcon;
  tone: keyof typeof TONES;
} {
  if (item.type === "sla") {
    if (item.slaType === "first_response") return { icon: Mail, tone: "blue" };
    return {
      icon: TriangleAlert,
      tone: item.kind === "sla_warning" ? "amber" : "red",
    };
  }

  switch (item.type) {
    case "ticket":
      return { icon: Ticket, tone: "teal" };
    case "reply":
      return { icon: MessageSquare, tone: "teal" };
    case "payment":
      return { icon: CreditCard, tone: "amber" };
    default:
      return { icon: Bell, tone: "slate" };
  }
}

function withinDate(iso: string, filter: DateFilter): boolean {
  const days = DATE_FILTERS.find((d) => d.id === filter)?.days ?? null;
  if (days === null) return true;

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  return new Date(iso).getTime() >= start.getTime();
}

function IconBadge({
  icon: Icon,
  tone,
  className,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONES;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full",
        TONES[tone],
        className,
      )}
    >
      <Icon className="size-4" />
    </div>
  );
}

function FilterMenu<T extends string>({
  icon: Icon,
  value,
  options,
  onChange,
  label,
}: {
  icon: LucideIcon;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  const current = options.find((o) => o.id === value) ?? options[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          aria-label={label}
          className="h-10 flex-1 justify-between gap-2 bg-card px-3 text-sm font-medium sm:flex-none"
        >
          <span className="flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground" />
            {current.label}
          </span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as T)}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EmptyState({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center text-sm text-muted-foreground">
      <IconBadge icon={Icon} tone="slate" className="size-11" />
      {children}
    </div>
  );
}

interface NotificationsViewProps {
  data: NotificationsData;
}

export default function NotificationsView({ data }: NotificationsViewProps) {
  const router = useRouter();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const live = useNotifications();
  const { hydrate } = live;
  // The shared feed stays live over realtime; the server's copy covers the
  // first paint until it has loaded.
  const prefs = live.prefs ?? data.prefs;
  const notifications = live.notifications ?? data.notifications;

  useEffect(() => {
    hydrate({ prefs: data.prefs, notifications: data.notifications });
  }, [data.prefs, data.notifications, hydrate]);
  const [tab, setTab] = useState<Tab>("all");
  const [term, setTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<NotificationFeedType | "all">(
    "all",
  );
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [page, setPage] = useState(1);
  const [isPending, startTransition] = useTransition();

  const unreadCount = notifications.filter((n) => n.unread).length;

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();

    return notifications.filter(
      (n) =>
        (tab !== "unread" || n.unread) &&
        (typeFilter === "all" || n.type === typeFilter) &&
        withinDate(n.createdAt, dateFilter) &&
        (!needle ||
          n.title.toLowerCase().includes(needle) ||
          n.subtitle.toLowerCase().includes(needle)),
    );
  }, [notifications, tab, term, typeFilter, dateFilter]);

  const history = useMemo(() => {
    const needle = term.trim().toLowerCase();

    return data.history.filter((change) => {
      const row = PREFERENCE_ROWS.find((r) => r.id === change.event);
      return (
        withinDate(change.createdAt, dateFilter) &&
        (!needle || row?.label.toLowerCase().includes(needle))
      );
    });
  }, [data.history, term, dateFilter]);

  const total = tab === "history" ? history.length : filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);
  const pageHistory = history.slice(start, start + PAGE_SIZE);

  // Any change to what's listed starts again from the first page.
  const resetPage =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  const togglePreference = (
    id: NotificationEventKey,
    channel: NotificationChannelKey,
  ) => {
    const nextPrefs: NotificationPrefs = {
      ...prefs,
      [channel]: { ...prefs[channel], [id]: !prefs[channel][id] },
    };
    startTransition(async () => {
      await live.savePrefs(nextPrefs);
    });
  };

  const markAllRead = () => {
    startTransition(async () => {
      await live.markAllRead();
    });
  };

  const setRead = (id: string, read: boolean) => {
    if (!notifications.some((n) => n.id === id && n.unread === read)) return;
    startTransition(async () => {
      await live.setRead(id, read);
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      await live.remove(id);
    });
  };

  const ticketHref = (item: NotificationFeedItem) =>
    item.ticketId
      ? tenantPath(tenantSlug, `${TENANT_ROUTES.TICKETS}/${item.ticketId}`)
      : null;

  const openItem = (item: NotificationFeedItem) => {
    setRead(item.id, true);
    const href = ticketHref(item);
    if (href) router.push(href);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "all", label: "All notifications" },
    { id: "unread", label: `Unread (${unreadCount})` },
    { id: "history", label: "Settings history" },
  ];

  return (
    <div className="h-full p-4 sm:p-6 lg:p-8">
      <div className="mx-auto space-y-4 sm:space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Notifications
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage how you receive alerts. Configure email and in-app
              notifications for important events.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={markAllRead}
            disabled={isPending || unreadCount === 0}
            className="h-10 w-full shrink-0 gap-2 bg-card px-4 text-sm font-semibold sm:w-auto"
          >
            <Mail className="size-4" />
            Mark all as read
          </Button>
        </div>

        <Card className="gap-4 rounded-xl bg-card p-4 sm:p-5 lg:p-6">
          <div className="grid grid-cols-1 items-end gap-y-1 sm:grid-cols-[minmax(0,1fr)_112px_112px] lg:grid-cols-[minmax(0,1fr)_160px_160px]">
            <div className="min-w-0 space-y-0.5">
              <h2 className="text-base font-bold text-foreground">
                Notification preferences
              </h2>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Choose which events you want to be notified about via email and
                in-app.
              </p>
            </div>
            {CHANNELS.map((c) => (
              <span
                key={c.id}
                className="hidden items-center justify-center gap-1.5 pb-0.5 text-sm font-semibold text-foreground sm:flex"
              >
                <c.icon className="size-4" />
                {c.label}
              </span>
            ))}
          </div>

          <div className="space-y-2">
            {PREFERENCE_ROWS.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-2 items-center gap-x-3 gap-y-3 rounded-lg border px-3 py-3 sm:grid-cols-[minmax(0,1fr)_112px_112px] sm:gap-y-0 sm:py-2.5 lg:grid-cols-[minmax(0,1fr)_160px_160px]"
              >
                <div className="col-span-2 flex min-w-0 items-center gap-3 sm:col-span-1 sm:gap-4">
                  <IconBadge
                    icon={row.icon}
                    tone={row.tone}
                    className="rounded-lg"
                  />
                  <div className="min-w-0 sm:pl-2">
                    <p className="text-sm font-semibold text-foreground">
                      {row.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.description}
                    </p>
                  </div>
                </div>
                {CHANNELS.map((channel) => (
                  <label
                    key={channel.id}
                    className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 sm:justify-center sm:bg-transparent sm:p-0"
                  >
                    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground sm:hidden">
                      <channel.icon className="size-3.5" />
                      {channel.label}
                    </span>
                    <Switch
                      checked={prefs[channel.id][row.id]}
                      disabled={isPending}
                      onCheckedChange={() =>
                        togglePreference(row.id, channel.id)
                      }
                      aria-label={`${row.label} — ${channel.label}`}
                    />
                  </label>
                ))}
              </div>
            ))}
          </div>
        </Card>

        <Card className="gap-0 overflow-hidden rounded-xl bg-card p-0">
          <div className="flex flex-col gap-3 border-b px-3 pt-2 sm:px-5 sm:pt-3 xl:flex-row xl:items-center xl:justify-between">
            <div
              role="tablist"
              aria-label="Notifications"
              className="-mx-3 -mb-px flex gap-1 overflow-x-auto px-3 scrollbar-none sm:mx-0 sm:px-0"
            >
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => resetPage(setTab)(t.id)}
                  className={cn(
                    "shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors",
                    tab === t.id
                      ? "border-primary! font-semibold text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center">
              <div className="relative w-full sm:flex-1 xl:w-64 xl:flex-none">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  value={term}
                  onChange={(event) => resetPage(setTerm)(event.target.value)}
                  placeholder="Search notifications..."
                  aria-label="Search notifications"
                  maxLength={200}
                  className="h-10 bg-card pl-9 text-sm"
                />
              </div>
              <div className="flex gap-2 sm:shrink-0">
                {tab !== "history" && (
                  <FilterMenu
                    icon={Filter}
                    label="Filter by type"
                    value={typeFilter}
                    options={TYPE_FILTERS}
                    onChange={resetPage(setTypeFilter)}
                  />
                )}
                <FilterMenu
                  icon={Calendar}
                  label="Filter by date"
                  value={dateFilter}
                  options={DATE_FILTERS}
                  onChange={resetPage(setDateFilter)}
                />
              </div>
            </div>
          </div>

          {tab === "history" ? (
            pageHistory.length === 0 ? (
              <EmptyState icon={Settings2}>
                No preference changes to show.
              </EmptyState>
            ) : (
              <ul className="divide-y">
                {pageHistory.map((change) => {
                  const row = PREFERENCE_ROWS.find(
                    (r) => r.id === change.event,
                  );
                  const channel = CHANNELS.find((c) => c.id === change.channel);
                  return (
                    <li
                      key={change.id}
                      className="flex items-start gap-3 px-4 py-3 sm:items-center sm:px-5"
                    >
                      <IconBadge
                        icon={change.enabled ? Bell : BellOff}
                        tone={change.enabled ? "teal" : "slate"}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">
                          {channel?.label} {change.enabled ? "on" : "off"} for “
                          {row?.label}”
                        </p>
                        <p className="text-xs text-muted-foreground">
                          You turned {change.enabled ? "on" : "off"}{" "}
                          {channel?.label.toLowerCase()} notifications for this
                          event.
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {change.time}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )
          ) : pageItems.length === 0 ? (
            <EmptyState icon={Bell}>
              {notifications.length === 0
                ? "No notifications yet. Ticket assignments and SLA alerts will show up here."
                : tab === "unread" && unreadCount === 0
                  ? "You're all caught up."
                  : "No notifications match your filters."}
            </EmptyState>
          ) : (
            <ul className="divide-y">
              {pageItems.map((item) => {
                const { icon, tone } = notificationIcon(item);
                const href = ticketHref(item);
                return (
                  <li
                    key={item.id}
                    className="group relative flex items-center gap-2  border-transparent pr-2 transition-colors hover:border-primary hover:bg-primary/5 sm:pr-3"
                  >
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left sm:pl-5"
                    >
                      <IconBadge icon={icon} tone={tone} />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "truncate text-sm text-foreground",
                            item.unread ? "font-semibold" : "font-medium",
                          )}
                        >
                          {item.title}
                        </p>
                        {item.subtitle && (
                          <p className="truncate text-xs text-muted-foreground">
                            {item.subtitle}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground md:hidden">
                          {item.time}
                        </p>
                      </div>
                      <span className="hidden w-32 shrink-0 text-xs text-muted-foreground md:block">
                        {item.time}
                      </span>
                    </button>

                    <span className="flex w-6 shrink-0 justify-center">
                      {item.unread && (
                        <span
                          className="size-2 rounded-full bg-primary"
                          aria-label="Unread"
                        />
                      )}
                    </span>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 text-muted-foreground"
                          aria-label={`Actions for ${item.title}`}
                        >
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        {href && (
                          <DropdownMenuItem asChild>
                            <Link
                              href={href}
                              onClick={() => setRead(item.id, true)}
                            >
                              <ExternalLink />
                              Open ticket
                            </Link>
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          disabled={isPending}
                          onSelect={() => setRead(item.id, item.unread)}
                        >
                          {item.unread ? <MailOpen /> : <Mail />}
                          {item.unread ? "Mark as read" : "Mark as unread"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={isPending}
                          onSelect={() => remove(item.id)}
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          )}

          {total > 0 && (
            <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 sm:flex-row sm:px-5">
              <p className="text-sm text-muted-foreground">
                Showing {start + 1}–{Math.min(start + PAGE_SIZE, total)} of{" "}
                {total} {tab === "history" ? "changes" : "notifications"}
              </p>
              {pageCount > 1 && (
                <Pagination
                  page={currentPage}
                  pageCount={pageCount}
                  onChange={setPage}
                  label="Notifications pages"
                />
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
