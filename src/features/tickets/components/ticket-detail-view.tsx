"use client";

import {
  Fragment,
  useState,
  useRef,
  useTransition,
  useMemo,
  useLayoutEffect,
  useEffect,
} from "react";
import { useRouter } from "next/navigation";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Paperclip, Loader2, X, Download } from "lucide-react";
import {
  Ticket,
  TicketMessage,
  TicketUploadedFile,
  TicketPriority,
  TicketStatus,
  MessageVisibility,
  TicketAttachment,
  SlaEvent,
  TicketSlaPolicy,
  TicketTag,
  PriorityChangeResult,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  isPriorityLowered,
} from "@/features/tickets/types/tickets.types";
import { PriorityConfirmDialog } from "@/features/tickets/components/priority-confirm-dialog";
import { AssignableAgent } from "@/features/tickets/services/tickets.service";
import {
  sendTicketMessageAction,
  updateTicketDetailsAction,
  assignTicketToMeAction,
  markTicketOpenedAction,
} from "@/features/tickets/actions/tickets.actions";
import { CharacterCount } from "@/components/shared/character-count";
import { MentionText } from "@/components/shared/mention-text";
import { serializeMention } from "@/lib/mentions";
import { isComposerSendKey, pastedFiles } from "@/lib/composer-keys";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRealtimeSlaEvents } from "@/hooks/use-realtime-sla-events";
import { useRealtimeMessages } from "@/hooks/use-realtime-messages";
import { useRealtimeTicket } from "@/hooks/use-realtime-ticket";
import { useNow } from "@/hooks/use-now";
import { useMounted } from "@/hooks/use-mounted";
import { useListNavigation } from "@/hooks/use-list-navigation";
import {
  SlaHeadlineBadge,
  TicketSlaCard,
} from "@/features/tickets/components/ticket-sla-card";
import { TicketTagsField } from "@/features/tickets/components/ticket-tags-field";
import { TicketThreadEmptyState } from "@/features/tickets/components/ticket-empty";
import {
  SupportClosedNotice,
  useSupportClosed,
} from "@/features/tickets/components/support-closed-notice";
import {
  TicketLifecycleActions,
  TicketLifecycleBanner,
} from "@/features/tickets/components/ticket-lifecycle";
import { Label } from "@/components/ui/label";
import { IndeterminateProgress } from "@/components/ui/indeterminate-progress";
import { BackLink } from "@/components/shared/back-link";
import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";
import { formatChatDay, formatChatTime, getInitials } from "@/lib/format";
import {
  TICKET_ATTACHMENT_ACCEPT,
  attachmentsError,
} from "@/features/tickets/lib/attachments";
import { TICKET_REPLY_MAX } from "@/features/tickets/lib/schemas";
import {
  discardTicketFiles,
  uploadTicketFiles,
} from "@/features/tickets/lib/upload";

/**
 * Attachment links are signed for an hour (ATTACHMENT_LINK_TTL_SECS); refetch
 * the page a little before that so a ticket left open keeps working links.
 */
const ATTACHMENT_LINK_REFRESH_MS = 50 * 60 * 1000;

/**
 * "last activity 5 min ago", in its own component so its 30-second tick
 * re-renders this line and not the whole ticket page.
 */
function LastActivity({ at }: { at: string }) {
  const now = useNow(30_000);
  const mins = Math.max(0, Math.floor((now - new Date(at).getTime()) / 60000));
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  const text =
    mins < 1
      ? "just now"
      : mins < 60
        ? `${mins} min ago`
        : hrs < 24
          ? `${hrs} hr${hrs > 1 ? "s" : ""} ago`
          : `${days} day${days > 1 ? "s" : ""} ago`;
  return (
    <span className="text-slate-400" suppressHydrationWarning>
      {" "}
      · last activity {text}
    </span>
  );
}

interface TicketDetailViewProps {
  ticket: Ticket;
  messages: TicketMessage[];
  attachments?: TicketAttachment[];
  slaEvents?: SlaEvent[];
  tenantslug: string;
  agents?: AssignableAgent[];
  mentionableMembers?: AssignableAgent[];
  currentUserId?: string | null;
  /** False for tenant admins: they aren't assignees, so no "Assign to me". */
  canAssignToSelf?: boolean;
  slaPolicy?: TicketSlaPolicy | null;
  tags?: TicketTag[];
  tenantTags?: TicketTag[];
  /** Days a resolved ticket waits before it is closed automatically. */
  autoCloseDays?: number;
}

/** "Saving…" beside a field's label while that field's change is saving. */
function SavingHint({ active }: { active: boolean }) {
  return (
    <span
      aria-live="polite"
      className={cn(
        "flex items-center gap-1 text-[11px] font-medium text-brand-accent transition-opacity duration-200",
        active ? "opacity-100" : "opacity-0",
      )}
    >
      {active && (
        <>
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Saving…
        </>
      )}
    </span>
  );
}

/**
 * A message's files inside its bubble: pictures as a preview, anything else
 * as a file row. Each opens its signed link in a new tab.
 */
function MessageFiles({
  files,
  fileExtension,
  formatSize,
}: {
  files: TicketAttachment[];
  fileExtension: (name: string) => string;
  formatSize: (bytes: number) => string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {files.map((att) =>
        att.mime?.startsWith("image/") && att.signed_url ? (
          <a
            key={att.id}
            href={att.signed_url}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-lg border border-black/5 bg-white"
          >
            {/* Signed storage URLs: next/image would need every host listed. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={att.signed_url}
              alt={att.original_filename}
              className="max-h-56 w-full max-w-72 object-cover"
            />
          </a>
        ) : (
          <a
            key={att.id}
            href={att.signed_url || "#"}
            target="_blank"
            rel="noreferrer"
            className="flex min-w-0 max-w-72 items-center gap-2.5 rounded-lg border border-black/5 bg-white px-2.5 py-2 transition-colors hover:bg-slate-50"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-bold text-slate-500">
              {(att.extension || fileExtension(att.original_filename))
                .toUpperCase()
                .slice(0, 3)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-slate-800">
                {att.original_filename}
              </span>
              <span className="block text-[10px] text-slate-400">
                {formatSize(att.size)}
              </span>
            </span>
            <Download
              className="size-3.5 shrink-0 text-slate-400"
              aria-hidden
            />
          </a>
        ),
      )}
    </div>
  );
}

const ROLE_LABELS: Record<string, string> = {
  tenant_admin: "Tenant Admin",
  manager: "Manager",
  agent: "Agent",
};

const CLOCK_LABELS: Record<SlaEvent["type"], string> = {
  first_response: "First response",
  resolution: "Resolution",
};

function announcePriorityChange(
  from: TicketPriority,
  to: TicketPriority,
  change: PriorityChangeResult | undefined,
) {
  if (change && !change.changed) return;
  const verb = isPriorityLowered(from, to) ? "lowered" : "raised";
  const kept = change?.slaKept ?? [];
  if (kept.length > 0) {
    const clocks = kept.map((t) => CLOCK_LABELS[t]).join(" and ");
    toast.success(
      `Priority ${verb} to ${TICKET_PRIORITY_LABELS[to]}. ${clocks} was due soon, so it keeps its original deadline.`,
    );
  } else {
    toast.success(`Priority ${verb} to ${TICKET_PRIORITY_LABELS[to]}.`);
  }
}

export default function TicketDetailView({
  ticket,
  messages: initialMessages = [],
  attachments = [],
  slaEvents: initialSlaEvents = [],
  tenantslug: tenant,
  agents = [],
  mentionableMembers = [],
  currentUserId = null,
  canAssignToSelf = true,
  slaPolicy = null,
  tags = [],
  tenantTags = [],
  autoCloseDays = 0,
}: TicketDetailViewProps) {
  const router = useRouter();
  // The first staff member to open the ticket. Nobody yet: this viewer is,
  // recorded once (the database keeps the first one if two race).
  const [openedBy, setOpenedBy] = useState<string | null>(
    ticket.opened_by ?? null,
  );
  const needsOpener = !ticket.opened_by && !!currentUserId;
  useEffect(() => {
    if (!needsOpener) return;
    let cancelled = false;
    markTicketOpenedAction({ ticketId: ticket.id, tenantSlug: tenant })
      .then((res) => {
        if (!cancelled && res.success && res.openedBy) {
          setOpenedBy(res.openedBy);
        }
      })
      .catch(() => {
        // Only the header line depends on it; the next visit tries again.
      });
    return () => {
      cancelled = true;
    };
  }, [needsOpener, ticket.id, tenant]);
  const { events: slaEvents, replaceEvents: replaceSlaEvents } =
    useRealtimeSlaEvents(ticket.id, initialSlaEvents);

  const memberNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of [...agents, ...mentionableMembers]) {
      if (m.id && !map[m.id]) map[m.id] = m.full_name;
    }
    return map;
  }, [agents, mentionableMembers]);
  const { messages, setMessages, lastActivityAt } = useRealtimeMessages(
    ticket.id,
    initialMessages,
    memberNameById,
  );

  // Opens on the newest message and follows the thread when one lands, as a
  // chat does. Keyed on the last message rather than every render, so an agent
  // scrolled up to reread something is not pulled back down while typing.
  const threadRef = useRef<HTMLDivElement>(null);
  const lastMessageId = messages.at(-1)?.id;
  // Message times and day dividers are in the viewer's time zone, which the
  // server can't know: they render once mounted (and the thread re-pins to
  // the bottom when they appear).
  const mounted = useMounted();
  useLayoutEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [lastMessageId, mounted]);

  const [, startTransition] = useTransition();
  const [isReplying, setIsReplying] = useState(false);
  // Which field is saving; the card's progress bar runs while any is.
  const [updatingField, setUpdatingField] = useState<
    "status" | "priority" | "assignee" | null
  >(null);
  const isUpdatingTicket = updatingField !== null;
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority);
  // A lowered priority waiting for confirmation.
  const [lowerTo, setLowerTo] = useState<TicketPriority | null>(null);
  // Anyone on staff counts as a real assignee here, so a ticket already given
  // to a tenant admin (before only agents and managers could be picked) still
  // shows who has it rather than "Unassigned".
  const isStaff = (id: string | null | undefined): id is string =>
    !!id && mentionableMembers.concat(agents).some((m) => m.id === id);
  const [assigneeId, setAssigneeId] = useState<string>(
    isStaff(ticket.assignee_id) ? ticket.assignee_id : "unassigned",
  );
  const [resolvedAt, setResolvedAt] = useState<string | null>(
    ticket.resolved_at ?? null,
  );
  const [closedAt, setClosedAt] = useState<string | null>(
    ticket.closed_at ?? null,
  );

  // A fresh server row (router.refresh after a realtime gap, or after a
  // save) replaces what the fields show. Skipped while a field is saving, so
  // its optimistic value isn't flipped back before the save lands.
  const [seenTicket, setSeenTicket] = useState(ticket);
  if (ticket !== seenTicket && updatingField === null) {
    setSeenTicket(ticket);
    setStatus(ticket.status);
    setPriority(ticket.priority);
    setResolvedAt(ticket.resolved_at ?? null);
    setClosedAt(ticket.closed_at ?? null);
    setAssigneeId(
      isStaff(ticket.assignee_id) ? ticket.assignee_id : "unassigned",
    );
  }

  // Changes made elsewhere: auto-close, a portal reopen, a teammate.
  useRealtimeTicket(ticket.id, (row) => {
    const statusMoved = row.status !== status;
    setStatus(row.status);
    setPriority(row.priority);
    setResolvedAt(row.resolved_at);
    setClosedAt(row.closed_at);
    setAssigneeId(
      isStaff(row.assignee_user_id) ? row.assignee_user_id : "unassigned",
    );
    // The policy summary is server-rendered.
    if (statusMoved || row.sla_policy_id !== (slaPolicy?.id ?? null))
      router.refresh();
  });

  // Each message's files sit in its bubble; files sent with the ticket itself
  // (no message) go with the opening request.
  const attachmentsByMessage = useMemo(() => {
    const map = new Map<string, TicketAttachment[]>();
    for (const att of attachments) {
      const key = att.message_id ?? `${ticket.id}:description`;
      map.set(key, [...(map.get(key) ?? []), att]);
    }
    return map;
  }, [attachments, ticket.id]);

  // Someone else's message arrives over realtime without its files (they are
  // recorded just after it, and links are signed on the server): refetch the
  // page shortly after so they show in the bubble.
  const lastMessage = messages.at(-1);
  const lastFromOther =
    !!lastMessage &&
    !(
      lastMessage.author_type === "agent" &&
      lastMessage.author_id === currentUserId
    ) &&
    !attachmentsByMessage.has(lastMessage.id);
  const [seenLastId] = useState(lastMessageId);
  useEffect(() => {
    if (!lastFromOther || lastMessageId === seenLastId) return;
    const id = setTimeout(() => router.refresh(), 1500);
    return () => clearTimeout(id);
  }, [lastFromOther, lastMessageId, seenLastId, router]);

  useEffect(() => {
    if (attachments.length === 0) return;
    const id = setInterval(() => router.refresh(), ATTACHMENT_LINK_REFRESH_MS);
    return () => clearInterval(id);
  }, [attachments.length, router]);
  const [replyType, setReplyType] = useState<MessageVisibility>("public");
  const replyInputRef = useRef<HTMLTextAreaElement>(null);
  // From the empty thread's buttons: pick the composer's mode and focus it.
  const startComposing = (type: MessageVisibility) => {
    setReplyType(type);
    replyInputRef.current?.focus();
  };
  const [replyText, setReplyText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The opening request is the ticket's description, shown as the first
  // customer post as the portal does. Older agent-created tickets also carry
  // it as a seeded customer message; that copy is dropped so it shows once.
  const opening = ticket.description?.trim() ?? "";
  const seededCopy = opening
    ? messages.find(
        (m) => m.author_type === "customer" && m.body.trim() === opening,
      )
    : undefined;
  const threadMessages: TicketMessage[] = opening
    ? [
        {
          id: `${ticket.id}:description`,
          tenant_id: ticket.tenant_id,
          ticket_id: ticket.id,
          author_type: "customer",
          author_id: "",
          body: ticket.description ?? "",
          visibility: "public",
          is_edited: false,
          created_at: ticket.created_at,
        },
        ...messages.filter((m) => m !== seededCopy),
      ]
    : messages;

  // Outside the policy's business hours the composer is locked.
  const supportClosed = useSupportClosed(slaPolicy?.calendar);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionActive, setMentionActive] = useState(false);
  const mentionStartRef = useRef<number | null>(null);

  const mentionMatches = mentionActive
    ? mentionableMembers.filter(
        (m) =>
          // No point @mentioning yourself.
          m.id !== currentUserId &&
          (!mentionQuery ||
            m.full_name.toLowerCase().includes(mentionQuery.toLowerCase()) ||
            m.email.toLowerCase().includes(mentionQuery.toLowerCase())),
      )
    : [];
  const {
    index: mentionIndex,
    setIndex: setMentionIndex,
    move: moveMention,
    itemProps: mentionItemProps,
  } = useListNavigation(mentionMatches.length);

  const applyMention = (member: AssignableAgent) => {
    if (mentionQuery === null) return;
    const start = mentionStartRef.current ?? replyText.lastIndexOf("@");
    if (start === -1) return;
    const before = replyText.slice(0, start);
    const after = replyText.slice(start + mentionQuery.length + 1);
    const inserted = `@${member.full_name}`;
    setReplyText(before + inserted + " " + after.replace(/^ +/, ""));
    setMentionQuery(null);
    setMentionActive(false);
    setMentionIndex(0);
    mentionStartRef.current = null;
  };

  const mentionMap = new Map<string, string>();
  for (const m of mentionableMembers) {
    mentionMap.set(m.full_name.toLowerCase(), m.id);
  }

  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const serializeBodyMentions = (body: string): string => {
    const names = Array.from(mentionMap.keys()).sort(
      (a, b) => b.length - a.length,
    );
    if (names.length === 0) return body;
    // At the start or after whitespace, as the picker opens, so the "@sam"
    // in "ops@sam.dev" isn't a mention; and not followed by a letter or
    // digit, so "@Samantha" isn't a mention of "Sam" with "antha" left over.
    const re = new RegExp(
      `(?<=^|\\s)@(${names.map((n) => escapeRegExp(n)).join("|")})(?![\\p{L}\\p{N}_])`,
      "giu",
    );
    return body.replace(re, (match, name: string) => {
      const id = mentionMap.get(name.toLowerCase());
      return id ? serializeMention(name, id) : match;
    });
  };

  const handleMentionKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (!mentionActive || mentionMatches.length === 0) return;
    if (moveMention(e.key)) {
      e.preventDefault();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const member = mentionMatches[mentionIndex];
      if (member) applyMention(member);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMentionActive(false);
      setMentionQuery(null);
      setMentionIndex(0);
      mentionStartRef.current = null;
    }
  };

  // Enter sends, Shift+Enter is a new line (see isComposerSendKey); the
  // mention picker gets the key first, so Enter there picks a name.
  const handleReplyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    handleMentionKeyDown(e);
    if (e.defaultPrevented || !isComposerSendKey(e)) return;
    e.preventDefault();
    if (!isReplying) handleSendReply();
  };

  // A pasted screenshot or file joins the attachments, under their limits.
  const handleReplyPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = pastedFiles(e);
    if (!pasted.length) return;
    e.preventDefault();
    const tooLarge = attachmentsError([...pendingFiles, ...pasted]);
    if (tooLarge) {
      toast.error(tooLarge);
      return;
    }
    setPendingFiles((prev) => [...prev, ...pasted]);
  };

  const handleReplyTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const caret = e.target.selectionStart ?? value.length;
    setReplyText(value);
    const beforeCaret = value.slice(0, caret);
    // Only an "@" at the start or after whitespace opens the picker, so an
    // email address (name@example.com) doesn't take over Enter.
    const caretMatch = beforeCaret.match(
      /(?:^|\s)@([\p{L}\p{M}\p{N}_ .'-]*)$/u,
    );
    if (caretMatch) {
      const q = caretMatch[1];
      if (q !== mentionQuery) setMentionIndex(0);
      setMentionActive(true);
      setMentionQuery(q);
      mentionStartRef.current = caret - caretMatch[1].length - 1;
    } else {
      setMentionActive(false);
      setMentionQuery(null);
      setMentionIndex(0);
      mentionStartRef.current = null;
    }
  };

  const handleSendReply = () => {
    if (supportClosed) return;
    if (!replyText.trim() && pendingFiles.length === 0) return;
    const tooLarge = attachmentsError(pendingFiles);
    if (tooLarge) {
      toast.error(tooLarge);
      return;
    }

    const body = serializeBodyMentions(replyText);
    const fd = new FormData();
    fd.append("ticketId", ticket.id);
    fd.append("tenantSlug", tenant);
    fd.append("body", body);
    fd.append("visibility", replyType);

    setIsReplying(true);
    startTransition(async () => {
      // Files go to storage straight from the browser first; the action
      // gets only their paths.
      let uploads: TicketUploadedFile[] = [];
      try {
        uploads = await uploadTicketFiles({
          tenantSlug: tenant,
          ticketId: ticket.id,
          files: pendingFiles,
        });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't upload the files. Please try again.",
        );
        setIsReplying(false);
        return;
      }
      try {
        const res = await sendTicketMessageAction(fd, uploads);
        if (res.success) {
          if (res.message && "id" in res.message) {
            // The saved row has no author name; the realtime copy that would
            // carry it is dropped as a duplicate, so add it here.
            const name = currentUserId
              ? memberNameById[currentUserId]
              : undefined;
            const sent: TicketMessage = {
              ...(res.message as TicketMessage),
              author_name: name,
              author_initials: name ? getInitials(name, "") : undefined,
            };
            setMessages((prev) =>
              prev.some((m) => m.id === sent.id) ? prev : [...prev, sent],
            );
          }
          // Sent, but its files didn't attach: say so, and don't invite a
          // resend that would post the reply twice.
          if ("warning" in res && res.warning) toast.warning(res.warning);
          setReplyText("");
          setPendingFiles([]);
          setMentionQuery(null);
          setMentionActive(false);
          setMentionIndex(0);
          mentionStartRef.current = null;
        } else {
          await discardTicketFiles(tenant, ticket.id, uploads);
          toast.error(res.error || "Failed to send reply.");
        }
      } catch {
        // The request itself failed (network): keep the typed reply and say
        // so instead of the error page. Files already filed are kept.
        await discardTicketFiles(tenant, ticket.id, uploads);
        toast.error("Couldn't send the reply. Please try again.");
      } finally {
        setIsReplying(false);
      }
    });
  };

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    e.target.value = "";
    if (!selected.length) return;
    const tooLarge = attachmentsError([...pendingFiles, ...selected]);
    if (tooLarge) {
      toast.error(tooLarge);
      return;
    }
    setPendingFiles((prev) => [...prev, ...selected]);
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const fileExtension = (name: string) =>
    (name.match(/\.([^.]+)$/) || [])[1]?.toUpperCase() || "FILE";

  const activityAt = lastActivityAt ?? ticket.created_at;

  // A staff member's name and role from the tenant's staff list; someone who
  // has since left the team is "Team member".
  const staffName = (id: string) =>
    id === currentUserId ? "You" : (memberNameById[id] ?? "Team member");
  const staffRole = (id: string) => {
    const role = mentionableMembers
      .concat(agents)
      .find((m) => m.id === id)?.role;
    return (role && ROLE_LABELS[role]) || "Staff";
  };
  // No creator recorded: the customer raised it on the portal (or it predates
  // the column).
  const createdBy = ticket.created_by
    ? { name: staffName(ticket.created_by), role: staffRole(ticket.created_by) }
    : {
        name: ticket.requester_name || "Customer",
        role: "Customer",
      };
  const handleStatusChange = (val: TicketStatus) => {
    const prev = status;
    setStatus(val);
    setUpdatingField("status");
    startTransition(async () => {
      try {
        const res = await updateTicketDetailsAction({
          ticketId: ticket.id,
          tenantSlug: tenant,
          status: val,
        });
        if (!res.success) {
          setStatus(prev);
          toast.error(res.error || "Failed to update status.");
        } else {
          if ("slaEvents" in res && res.slaEvents)
            replaceSlaEvents(res.slaEvents);
          if (val === "resolved") toast.success("Ticket resolved.");
          else if (val === "closed") toast.success("Ticket closed.");
          else if (prev === "resolved" || prev === "closed")
            toast.success("Ticket reopened.");
          else toast.success(`Status changed to ${TICKET_STATUS_LABELS[val]}.`);
          // updateTicketDetailsAction's revalidatePath refreshes the page.
        }
      } finally {
        setUpdatingField(null);
      }
    });
  };

  const isClosed = status === "closed";

  // Only an empty composer switches to "Send to customer": a half-written
  // internal note keeps its type, so R then Enter can't publish it. Off while
  // support is closed, as the composer is.
  useKeyboardShortcut(
    "r",
    () =>
      replyText.trim() || pendingFiles.length > 0
        ? replyInputRef.current?.focus()
        : startComposing("public"),
    !isClosed && !supportClosed,
  );

  const savePriority = (val: TicketPriority) => {
    const prev = priority;
    setPriority(val);
    setUpdatingField("priority");
    startTransition(async () => {
      try {
        const res = await updateTicketDetailsAction({
          ticketId: ticket.id,
          tenantSlug: tenant,
          priority: val,
        });
        if (!res.success) {
          setPriority(prev);
          toast.error(res.error || "Failed to update priority.");
          return;
        }
        setLowerTo(null);
        if ("slaEvents" in res && res.slaEvents) {
          // The new priority's targets, with the time already used kept --
          // or, for a clock that was due soon, its original deadline.
          replaceSlaEvents(res.slaEvents);
        }
        announcePriorityChange(
          prev,
          val,
          "priorityChange" in res ? res.priorityChange : undefined,
        );
      } finally {
        setUpdatingField(null);
      }
    });
  };

  // Raising is immediate; lowering asks for confirmation first.
  const handlePriorityChange = (val: TicketPriority) => {
    if (val === priority) return;
    if (isPriorityLowered(priority, val)) {
      setLowerTo(val);
      return;
    }
    savePriority(val);
  };

  const handleAssigneeChange = (val: string) => {
    const prev = assigneeId;
    setAssigneeId(val);
    if (val === "unassigned") {
      setUpdatingField("assignee");
      startTransition(async () => {
        try {
          const res = await updateTicketDetailsAction({
            ticketId: ticket.id,
            tenantSlug: tenant,
            unassign: true,
          });
          if (!res.success) {
            setAssigneeId(prev);
            toast.error(res.error || "Failed to unassign ticket.");
          } else {
            toast.success("Ticket unassigned.");
          }
        } finally {
          setUpdatingField(null);
        }
      });
      return;
    }
    if (val === "me") {
      setUpdatingField("assignee");
      startTransition(async () => {
        try {
          const res = await assignTicketToMeAction({
            ticketId: ticket.id,
            tenantSlug: tenant,
          });
          if (res.success && res.assigneeId) {
            setAssigneeId(res.assigneeId);
            toast.success("Ticket assigned to you.");
          } else {
            setAssigneeId(prev);
            toast.error(res.error || "Failed to assign ticket to you.");
          }
        } finally {
          setUpdatingField(null);
        }
      });
      return;
    }
    setUpdatingField("assignee");
    startTransition(async () => {
      try {
        const res = await updateTicketDetailsAction({
          ticketId: ticket.id,
          tenantSlug: tenant,
          assigneeId: val,
        });
        if (!res.success) {
          setAssigneeId(prev);
          toast.error(res.error || "Failed to assign ticket.");
        } else {
          const name = agents.find((a) => a.id === val)?.full_name;
          toast.success(
            name ? `Ticket assigned to ${name}.` : "Ticket assigned.",
          );
        }
      } finally {
        setUpdatingField(null);
      }
    });
  };

  return (
    // Laid out like a chat window: from lg up the page is the height of <main>,
    // the conversation fills the left column with only its thread scrolling and
    // the composer pinned under it, and the sidebar scrolls on its own. Below
    // lg the chat card takes most of the screen and the sidebar follows it.
    <div className="flex h-full flex-col overflow-y-auto p-4 font-sans sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full flex-1 flex-col gap-6 lg:min-h-0">
        <div>
          <BackLink href={tenantPath(tenant, TENANT_ROUTES.TICKETS)}>
            Back to queue
          </BackLink>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-slate-400 font-medium">
              #{ticket.number ?? "-"}
            </span>
            {!isClosed && status !== "resolved" && (
              <SlaHeadlineBadge events={slaEvents} policy={slaPolicy} />
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <h1 className="min-w-0 text-2xl font-bold tracking-tight text-slate-900 wrap-break-word">
              {ticket.subject}
            </h1>
            <div className="shrink-0">
              <TicketLifecycleActions
                status={status}
                disabled={isUpdatingTicket}
                onChange={handleStatusChange}
              />
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Created by{" "}
            <span className="font-semibold text-slate-700">
              {createdBy.name}
            </span>{" "}
            <span className="text-slate-400">({createdBy.role})</span>
            {openedBy && (
              <>
                {" "}
                · Opened by{" "}
                <span className="font-semibold text-slate-700">
                  {staffName(openedBy)}
                </span>{" "}
                <span className="text-slate-400">({staffRole(openedBy)})</span>
              </>
            )}
            <LastActivity at={activityAt} />
          </p>

          <TicketLifecycleBanner
            status={status}
            resolvedAt={resolvedAt}
            closedAt={closedAt}
            autoCloseDays={autoCloseDays}
          />
        </div>

        {/* min-h keeps a short laptop screen from squeezing the thread to
            nothing -- there the page scrolls instead. grid-rows-1 is
            minmax(0, 1fr): with the default auto row the taller column (the
            sidebar) set the row's height and pushed the page into a scroll. */}
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:min-h-112 lg:flex-1 lg:grid-cols-3 lg:grid-rows-1">
          <section className="flex h-[75dvh] min-h-112 flex-col overflow-hidden rounded-xl bg-white shadow-sm lg:col-span-2 lg:h-auto lg:min-h-0">
            {/* The only part of the card that scrolls. */}
            <div
              ref={threadRef}
              className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-5 sm:py-5"
            >
              {threadMessages.length === 0 && (
                <TicketThreadEmptyState
                  closed={isClosed}
                  onReply={() => startComposing("public")}
                  onNote={() => startComposing("internal")}
                />
              )}
              {threadMessages.map((msg, i) => {
                const isInternal = msg.visibility === "internal";
                const isCustomer = msg.author_type === "customer";
                const isMine =
                  !isCustomer &&
                  !!currentUserId &&
                  msg.author_id === currentUserId;
                const authorName =
                  msg.author_name ||
                  (isCustomer ? ticket.requester_name || "Customer" : "Agent");
                const day = mounted ? formatChatDay(msg.created_at) : "";
                const prev = threadMessages[i - 1];
                const newDay =
                  mounted && (!prev || formatChatDay(prev.created_at) !== day);

                // A chat seen by whoever is looking: your own messages on the
                // right without a name, everyone else's (the customer and
                // teammates) on the left with an avatar and name.
                const files = attachmentsByMessage.get(msg.id) ?? [];
                const initials =
                  msg.author_initials ||
                  (isCustomer
                    ? ticket.requester_name
                      ? getInitials(ticket.requester_name, "")
                      : "CU"
                    : getInitials(authorName, ""));
                return (
                  <Fragment key={msg.id}>
                    {newDay && (
                      <p className="pt-1 text-center text-xs font-medium text-slate-500">
                        {day}
                      </p>
                    )}
                    <article
                      className={cn(
                        "flex min-w-0 flex-col gap-1",
                        isMine ? "items-end" : "items-start",
                      )}
                    >
                      <p
                        className={cn(
                          "flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-slate-500",
                          !isMine && "ml-10.5",
                        )}
                      >
                        {!isMine && (
                          <span className="font-medium wrap-break-word text-slate-700">
                            {authorName}
                          </span>
                        )}
                        <span>
                          {mounted ? formatChatTime(msg.created_at) : "\u00a0"}
                        </span>
                        {isInternal && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                            Internal note
                          </span>
                        )}
                      </p>

                      <div
                        className={cn(
                          "flex w-full min-w-0 items-start gap-2.5",
                          isMine && "justify-end",
                        )}
                      >
                        {!isMine && (
                          <span
                            aria-hidden
                            className={cn(
                              "flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                              isCustomer
                                ? "bg-brand-accent text-brand-accent-foreground"
                                : "bg-slate-600 text-white",
                            )}
                          >
                            {initials}
                          </span>
                        )}
                        <div
                          className={cn(
                            "min-w-0 max-w-[85%] space-y-2 rounded-2xl px-3.5 py-2 text-sm leading-[1.6] text-slate-800 sm:max-w-[75%]",
                            isMine ? "rounded-tr-sm" : "rounded-tl-sm",
                            isInternal
                              ? "border border-amber-200 bg-amber-50"
                              : isMine
                                ? "bg-brand-accent/10"
                                : "bg-slate-100",
                          )}
                        >
                          {msg.body.trim() && (
                            <div className="whitespace-pre-line wrap-break-word">
                              <MentionText text={msg.body} />
                            </div>
                          )}
                          {files.length > 0 && (
                            <MessageFiles
                              files={files}
                              fileExtension={fileExtension}
                              formatSize={formatSize}
                            />
                          )}
                        </div>
                      </div>
                    </article>
                  </Fragment>
                );
              })}
            </div>

            {/* Pinned under the thread, as a chat composer is. */}
            {isClosed ? (
              <p className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3 text-center text-xs text-slate-500">
                This ticket is closed. Reopen it to reply.
              </p>
            ) : (
              <div
                className={`shrink-0 border-t transition-colors ${
                  replyType === "internal"
                    ? "bg-amber-50 border-amber-200"
                    : "bg-slate-50/60 border-slate-200"
                }`}
              >
                {supportClosed && (
                  <SupportClosedNotice closed={supportClosed} />
                )}
                <div className="flex items-center space-x-2 px-3 sm:px-4 pt-3">
                  <Button
                    type="button"
                    variant="ghost"
                    aria-pressed={replyType === "public"}
                    onClick={() => setReplyType("public")}
                    disabled={!!supportClosed}
                    className={`h-9 px-2.5 sm:px-3 text-xs font-semibold rounded-lg border transition-all ${
                      replyType === "public"
                        ? "border-teal-700 text-teal-700 bg-teal-700/10 shadow-sm  hover:bg-teal-700/10 hover:text-teal-700"
                        : "border-transparent text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Reply to customer
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-pressed={replyType === "internal"}
                    onClick={() => setReplyType("internal")}
                    disabled={!!supportClosed}
                    className={`h-9 px-2.5 sm:px-3 text-xs font-semibold rounded-lg border transition-all ${
                      replyType === "internal"
                        ? "border-amber-600 text-amber-800 bg-amber-100/50 shadow-sm  hover:bg-amber-100/50 hover:text-amber-800"
                        : "border-transparent text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Internal note
                  </Button>
                </div>

                {/* One box, as a chat app's: the files going with the message
                    sit above the text, the paperclip beside it. */}
                <div className="relative mx-3 mt-2 rounded-lg border border-slate-200 bg-white focus-within:border-slate-300 sm:mx-4">
                  {pendingFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2 px-2.5 pt-2.5">
                      {pendingFiles.map((file, i) => (
                        <div
                          key={`${file.name}-${i}`}
                          className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-md pl-2 pr-1 py-1 text-[11px] font-medium text-slate-700"
                        >
                          <span className="w-4 h-4 rounded bg-slate-100 flex items-center justify-center text-[8px] font-bold text-slate-500 shrink-0">
                            {fileExtension(file.name).slice(0, 3)}
                          </span>
                          <span className="truncate max-w-30">{file.name}</span>
                          <span className="text-slate-400 text-[10px] shrink-0">
                            {formatSize(file.size)}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => removePendingFile(i)}
                            aria-label={`Remove ${file.name}`}
                            className="ml-1 shrink-0 text-slate-400 hover:text-slate-700"
                          >
                            <X className="size-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-end gap-1 pr-1.5">
                    <textarea
                      ref={replyInputRef}
                      rows={2}
                      value={replyText}
                      onChange={handleReplyTextChange}
                      onKeyDown={handleReplyKeyDown}
                      onPaste={handleReplyPaste}
                      maxLength={TICKET_REPLY_MAX}
                      disabled={!!supportClosed}
                      placeholder={
                        supportClosed
                          ? "Replies are disabled while support is closed."
                          : replyType === "internal"
                            ? "Visible to your team only - context, root cause, next steps."
                            : `Write a reply to ${ticket.requester_name || "John Doe"}...`
                      }
                      className="block max-h-40 min-h-16 w-full flex-1 resize-none overflow-y-auto rounded-lg border-0 bg-transparent px-3 py-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:outline-none focus:ring-0 focus-visible:ring-0 disabled:cursor-not-allowed sm:text-sm"
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept={TICKET_ATTACHMENT_ACCEPT}
                      className="hidden"
                      onChange={handleFilesSelected}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!!supportClosed}
                      aria-label="Attach files"
                      title="Attach files"
                      className="mb-1.5 size-8 shrink-0 text-slate-500 hover:text-slate-800"
                    >
                      <Paperclip className="size-4" />
                    </Button>
                  </div>
                  {/* Opens upward: the composer sits at the bottom of the card. */}
                  {mentionActive && mentionMatches.length > 0 && (
                    <div className="absolute bottom-full left-3 z-30 mb-1 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg sm:left-4">
                      <p className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Mention someone
                      </p>
                      <div
                        role="listbox"
                        aria-label="Mention someone"
                        className="max-h-48 overflow-y-auto"
                      >
                        {mentionMatches.map((member, idx) => {
                          const item = mentionItemProps(idx);
                          return (
                            <Button
                              key={member.id}
                              type="button"
                              variant="ghost"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setMentionIndex(idx);
                                applyMention(member);
                              }}
                              {...item}
                              className={cn(
                                "h-auto w-full justify-start gap-2 rounded-none px-3 py-2 text-left",
                                item.className,
                              )}
                            >
                              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">
                                {getInitials(member.full_name, member.email)}
                              </span>
                              <span
                                className={cn(
                                  "truncate text-xs font-medium",
                                  idx === mentionIndex
                                    ? "text-teal-900"
                                    : "text-slate-800",
                                )}
                              >
                                {member.full_name}
                              </span>
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <CharacterCount
                  length={replyText.length}
                  max={TICKET_REPLY_MAX}
                  className="px-3 pt-1 sm:px-4"
                />

                <div className="px-3 sm:px-4 pt-2 pb-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                  <div className="flex items-center space-x-3">
                    <span className="text-[10px] sm:text-xs text-slate-400 hidden sm:inline">
                      {replyType === "internal"
                        ? "Not sent to the customer."
                        : "Shows on the portal."}
                    </span>
                    <span className="text-[10px] sm:text-xs text-slate-400 hidden lg:inline">
                      Enter to send · Shift+Enter for a new line
                    </span>
                  </div>

                  <Button
                    size="sm"
                    onClick={handleSendReply}
                    disabled={
                      isReplying ||
                      !!supportClosed ||
                      (!replyText.trim() && pendingFiles.length === 0)
                    }
                    className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold px-4 h-10 rounded-lg transition-colors shadow-sm"
                  >
                    {isReplying && (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    )}
                    {replyType === "internal"
                      ? "Add internal note"
                      : "Send to customer"}
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* From lg up the sidebar is as tall as the chat card: the details
              and SLA cards keep their size and the attachments card takes the
              rest, scrolling its own list. The cards carry their padding once
              (CardContent's), not Card's py on top, so details and SLA fit
              and only the attachments scroll. On a screen too short for even
              that the column scrolls -- never the page. */}
          <div className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto">
            <Card className="relative shrink-0 gap-0 py-0 shadow-sm border-slate-200 bg-white ring-0">
              <div className="absolute top-0 left-0 right-0 z-10">
                <IndeterminateProgress
                  active={isUpdatingTicket}
                  label="Updating ticket"
                />
              </div>
              <CardContent className="p-4 space-y-3 text-xs">
                <div className="flex items-center space-x-3 pb-3 border-b border-slate-100">
                  <div className="w-9 h-9 rounded-full bg-slate-500 text-white flex items-center justify-center text-xs font-bold">
                    {ticket.requester_name
                      ? getInitials(ticket.requester_name, "")
                      : "CU"}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900">
                      {ticket.requester_name}
                    </h4>
                    {ticket.requester_company && (
                      <p className="text-[11px] text-slate-400">
                        {ticket.requester_company}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <Label
                    htmlFor="status"
                    className="flex items-center justify-between font-semibold text-slate-700"
                  >
                    Status
                    <SavingHint active={updatingField === "status"} />
                  </Label>
                  <Select
                    value={status}
                    onValueChange={handleStatusChange}
                    disabled={isUpdatingTicket}
                  >
                    <SelectTrigger
                      id="status"
                      className="h-9 min-h-9 w-full bg-white border-slate-200"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      side="bottom"
                      align="start"
                      position="popper"
                      className="p-1"
                    >
                      {TICKET_STATUSES.map((s) => (
                        <SelectItem
                          key={s}
                          value={s}
                          className="cursor-pointer p-2"
                        >
                          {TICKET_STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1.5">
                  <Label
                    htmlFor="priority"
                    className="flex items-center justify-between font-semibold text-slate-700"
                  >
                    Priority
                    <SavingHint active={updatingField === "priority"} />
                  </Label>
                  <Select
                    value={priority}
                    onValueChange={handlePriorityChange}
                    disabled={isUpdatingTicket}
                  >
                    <SelectTrigger
                      id="priority"
                      className="h-9 min-h-9 w-full bg-white border-slate-200"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      side="bottom"
                      align="start"
                      position="popper"
                      className="p-1"
                    >
                      {TICKET_PRIORITIES.map((p) => (
                        <SelectItem
                          key={p}
                          value={p}
                          className="cursor-pointer p-2"
                        >
                          {TICKET_PRIORITY_LABELS[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1.5">
                  <Label
                    htmlFor="assignee"
                    className="flex items-center justify-between font-semibold text-slate-700"
                  >
                    Assignee
                    <SavingHint active={updatingField === "assignee"} />
                  </Label>
                  <Select
                    value={assigneeId}
                    onValueChange={handleAssigneeChange}
                    disabled={isUpdatingTicket}
                  >
                    <SelectTrigger
                      id="assignee"
                      className="h-9 min-h-9 w-full bg-white border-slate-200"
                    >
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent
                      side="bottom"
                      align="start"
                      position="popper"
                      className="p-1"
                    >
                      {currentUserId &&
                        canAssignToSelf &&
                        assigneeId !== currentUserId && (
                          <SelectItem value="me" className="cursor-pointer p-2">
                            Assign to me
                          </SelectItem>
                        )}
                      {/* The current assignee, if no longer pickable (a
                          tenant admin), so the select can still name them. */}
                      {assigneeId !== "unassigned" &&
                        !agents.some((a) => a.id === assigneeId) && (
                          <SelectItem
                            value={assigneeId}
                            disabled
                            className="cursor-pointer p-2"
                          >
                            {memberNameById[assigneeId] ?? "Team member"}
                          </SelectItem>
                        )}
                      {/* "Assign to me" stands in for the viewer's own row;
                          keep it only while they're the assignee so the
                          select can still name them. */}
                      {agents
                        .filter(
                          (agent) =>
                            !(
                              currentUserId &&
                              canAssignToSelf &&
                              agent.id === currentUserId &&
                              assigneeId !== currentUserId
                            ),
                        )
                        .map((agent) => (
                          <SelectItem
                            key={agent.id}
                            value={agent.id}
                            className="cursor-pointer p-2"
                          >
                            {agent.full_name}
                          </SelectItem>
                        ))}
                      <SelectItem
                        value="unassigned"
                        className="cursor-pointer p-2"
                      >
                        Unassigned
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <TicketTagsField
                  tenant={tenant}
                  ticketId={ticket.id}
                  initialTags={tags}
                  suggestions={tenantTags}
                />
              </CardContent>
            </Card>

            <div className="shrink-0">
              <TicketSlaCard
                events={slaEvents}
                policy={slaPolicy}
                updating={isUpdatingTicket}
                priority={priority}
              />
            </div>

            <Card className="shrink-0 gap-0 py-0 shadow-sm border-slate-200 bg-white ring-0 lg:min-h-28 lg:flex-1 lg:shrink lg:basis-0">
              <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-4 text-xs">
                <h4 className="shrink-0 font-bold uppercase tracking-wider text-[11px] text-slate-400">
                  Attachments
                </h4>

                {attachments.length === 0 ? (
                  <p className="text-[11px] text-slate-400">
                    No attachments on this ticket.
                  </p>
                ) : (
                  <div className="-mr-2 max-h-72 min-h-0 flex-1 space-y-2 overflow-y-auto pr-2 lg:max-h-none">
                    {attachments.map((att) => (
                      <a
                        key={att.id}
                        href={att.signed_url || "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2.5 rounded-lg border border-slate-200 flex items-center space-x-3 bg-white hover:bg-slate-50 transition-colors"
                      >
                        <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
                          {(
                            att.extension ||
                            fileExtension(att.original_filename)
                          ).slice(0, 3)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-slate-800 truncate">
                            {att.original_filename}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {formatSize(att.size)}
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <PriorityConfirmDialog
        open={lowerTo !== null}
        to={lowerTo}
        pending={isUpdatingTicket}
        onCancel={() => setLowerTo(null)}
        onConfirm={() => lowerTo && savePriority(lowerTo)}
      />
    </div>
  );
}
