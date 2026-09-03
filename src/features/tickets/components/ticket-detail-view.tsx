"use client";

import { useState, useRef, useTransition, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, Paperclip, Loader2, X } from "lucide-react";
import {
  Ticket,
  TicketMessage,
  TicketPriority,
  TicketStatus,
  MessageVisibility,
  TicketAttachment,
  SlaEvent,
} from "@/features/tickets/types/tickets.types";
import { AssignableAgent } from "@/features/tickets/services/tickets.service";
import {
  sendTicketMessageAction,
  updateTicketDetailsAction,
  assignTicketToMeAction,
} from "@/features/tickets/actions/tickets.actions";
import { MentionText } from "@/components/shared/mention-text";
import { serializeMention } from "@/lib/mentions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRealtimeSlaEvents } from "@/hooks/use-realtime-sla-events";
import { useRealtimeMessages } from "@/hooks/use-realtime-messages";
import { Label } from "@/components/ui/label";

interface TicketDetailViewProps {
  ticket: Ticket;
  messages: TicketMessage[];
  attachments?: TicketAttachment[];
  slaEvents?: SlaEvent[];
  tenantslug: string;
  agents?: AssignableAgent[];
  mentionableMembers?: AssignableAgent[];
  currentUserId?: string | null;
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
}: TicketDetailViewProps) {
  const slaEvents = useRealtimeSlaEvents(ticket.id, initialSlaEvents);

  const memberNameById: Record<string, string> = {};
  for (const m of [...agents, ...mentionableMembers]) {
    if (m.id && !memberNameById[m.id]) memberNameById[m.id] = m.full_name;
  }
  const { messages, lastActivityAt } = useRealtimeMessages(
    ticket.id,
    initialMessages,
    memberNameById,
  );

  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority);
  const [assigneeId, setAssigneeId] = useState<string>(
    agents.some((a) => a.id === ticket.assignee_id)
      ? ticket.assignee_id!
      : "unassigned",
  );
  const [replyType, setReplyType] = useState<MessageVisibility>("public");
  const [replyText, setReplyText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionActive, setMentionActive] = useState(false);
  const mentionRef = useRef<HTMLDivElement>(null);

  const mentionMatches = mentionActive
    ? mentionableMembers.filter(
        (m) =>
          !mentionQuery ||
          m.full_name.toLowerCase().includes(mentionQuery.toLowerCase()) ||
          m.email.toLowerCase().includes(mentionQuery.toLowerCase()),
      )
    : [];

  const applyMention = (member: AssignableAgent) => {
    if (mentionQuery === null) return;
    const mentionToken = `@${mentionQuery}`;
    const idx = replyText.lastIndexOf(mentionToken);
    if (idx === -1) return;
    const before = replyText.slice(0, idx);
    const after = replyText.slice(idx + mentionToken.length);
    setReplyText(
      before + serializeMention(member.full_name, member.id) + after,
    );
    setMentionQuery(null);
    setMentionActive(false);
  };

  const handleReplyTextChange = (value: string) => {
    setReplyText(value);
    const caretMatch = value.slice(0, value.length).match(/@([\w .-]*)$/);
    if (caretMatch) {
      setMentionActive(true);
      setMentionQuery(caretMatch[1]);
    } else {
      setMentionActive(false);
      setMentionQuery(null);
    }
  };

  const hasPendingSla = slaEvents.some((e) => e.status === "pending");
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!hasPendingSla) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [hasPendingSla]);

  const handleSendReply = () => {
    if (!replyText.trim() && pendingFiles.length === 0) return;

    const fd = new FormData();
    fd.append("ticketId", ticket.id);
    fd.append("tenantId", tenant);
    fd.append("body", replyText);
    fd.append("visibility", replyType);
    pendingFiles.forEach((f) => fd.append("files", f));

    startTransition(async () => {
      const res = await sendTicketMessageAction(fd);
      if (res.success) {
        setReplyText("");
        setPendingFiles([]);
        setMentionQuery(null);
        setMentionActive(false);
      }
    });
  };

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length) {
      setPendingFiles((prev) => [...prev, ...selected]);
    }
    e.target.value = "";
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

  const humanizeStatus = (value: string) =>
    value
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

  const formatRemaining = (ms: number) => {
    const abs = Math.abs(ms);
    const minutes = Math.floor(abs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h left`;
    if (hours > 0) return `${hours}h ${minutes % 60}m left`;
    return `${minutes}m left`;
  };

  const formatClock = (iso?: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    let h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, "0");
    const meridiem = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${m} ${meridiem}`;
  };

  const activityAt = lastActivityAt ?? ticket.created_at;
  const lastActivityText = (() => {
    const diff = now - new Date(activityAt).getTime();
    const mins = Math.max(0, Math.floor(diff / 60000));
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  })();
  const slaRemainingText = (ev: SlaEvent) => {
    const start = new Date(ev.created_at).getTime();
    const due = new Date(ev.due_at).getTime();
    const total = due - start;
    const remaining = due - now;
    const elapsedPct = total > 0 ? ((now - start) / total) * 100 : 100;

    let text = `${formatRemaining(remaining)}`;
    let badgeStyle =
      "bg-emerald-100 text-emerald-900 border border-emerald-200/60";
    let dotStyle = "bg-emerald-600";

    if (ev.status === "completed") {
      text = "Completed";
      badgeStyle = "bg-slate-100 text-slate-700 border border-slate-200/60";
      dotStyle = "bg-slate-500";
    } else if (ev.status === "breached" || remaining <= 0) {
      text = "Breached";
      badgeStyle = "bg-red-100 text-red-800 border border-red-200/80";
      dotStyle = "bg-red-500";
    } else if (elapsedPct >= 75 || remaining < 600000) {
      badgeStyle = "bg-amber-100 text-amber-900 border border-amber-200/60";
      dotStyle = "bg-amber-600";
    }

    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${badgeStyle}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotStyle}`} />
        {text}
      </span>
    );
  };

  const slaRemainingTone = (ev: SlaEvent) => {
    if (ev.status === "completed") return "bg-slate-100 text-slate-600";
    if (ev.status === "breached") return "bg-red-100/70 text-red-800";

    const start = new Date(ev.created_at).getTime();
    const due = new Date(ev.due_at).getTime();
    const total = due - start;
    const remaining = due - now;
    const elapsedPct = total > 0 ? ((now - start) / total) * 100 : 100;

    if (remaining <= 0) return "bg-red-100/70 text-red-800";
    if (elapsedPct >= 75 || remaining < 600000)
      return "bg-amber-50 text-amber-800";
    return "bg-emerald-50 text-emerald-800";
  };

  const slaProgressPercent = (ev: SlaEvent) => {
    if (ev.status === "breached") return 100;
    if (ev.status === "completed") return 100;
    const start = new Date(ev.created_at).getTime();
    const due = new Date(ev.due_at).getTime();
    const total = due - start;
    if (total <= 0) return 100;
    const elapsed = ((now - start) / total) * 100;
    return Math.max(0, Math.min(100, Math.round(elapsed)));
  };

  const slaBarColor = (ev: SlaEvent) => {
    if (ev.status === "completed") return "bg-slate-400";
    if (ev.status === "breached") return "bg-red-400";
    const pct = slaProgressPercent(ev);
    if (pct >= 100) return "bg-red-400";
    if (pct >= 75) return "bg-amber-400";
    return "bg-emerald-500";
  };
  const handleStatusChange = (val: TicketStatus) => {
    const prev = status;
    setStatus(val);
    startTransition(async () => {
      const res = await updateTicketDetailsAction({
        ticketId: ticket.id,
        tenantId: tenant,
        status: val,
      });
      if (!res.success) {
        setStatus(prev);
        toast.error(res.error || "Failed to update status.");
      }
    });
  };

  const handlePriorityChange = (val: TicketPriority) => {
    const prev = priority;
    setPriority(val);
    startTransition(async () => {
      const res = await updateTicketDetailsAction({
        ticketId: ticket.id,
        tenantId: tenant,
        priority: val,
      });
      if (!res.success) {
        setPriority(prev);
        toast.error(res.error || "Failed to update priority.");
      }
    });
  };

  const handleAssigneeChange = (val: string) => {
    const prev = assigneeId;
    setAssigneeId(val);
    if (val === "unassigned") {
      startTransition(async () => {
        const res = await updateTicketDetailsAction({
          ticketId: ticket.id,
          tenantId: tenant,
          unassign: true,
        });
        if (!res.success) {
          setAssigneeId(prev);
          toast.error(res.error || "Failed to unassign ticket.");
        }
      });
      return;
    }
    if (val === "me") {
      startTransition(async () => {
        const res = await assignTicketToMeAction({
          ticketId: ticket.id,
          tenantId: tenant,
        });
        if (res.success && res.assigneeId) {
          setAssigneeId(res.assigneeId);
        } else {
          setAssigneeId(ticket.assignee_id || "unassigned");
          toast.error(res.error || "Failed to assign ticket to you.");
        }
      });
      return;
    }
    startTransition(async () => {
      const res = await updateTicketDetailsAction({
        ticketId: ticket.id,
        tenantId: tenant,
        assigneeId: val,
      });
      if (!res.success) {
        setAssigneeId(prev);
        toast.error(res.error || "Failed to assign ticket.");
      }
    });
  };

  return (
    <div className="h-full bg-slate-50/50 font-sans text-slate-700">
      <div className="max-w mx-auto space-y-6">
        <div>
          <Link
            href={`/${tenant}/tickets`}
            className="inline-flex items-center text-xs font-semibold text-emerald-700 hover:text-emerald-800 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 mr-0.5" />
            Back to queue
          </Link>
        </div>

        <div className="space-y-2">
          <div className="flex items-center space-x-3 text-xs">
            <span className="text-slate-400 font-medium">
              #{ticket.id.substring(0, 4)}
            </span>
            {(() => {
              const headEv =
                slaEvents.find((e) => e.status === "pending") || slaEvents[0];
              if (headEv) {
                return slaRemainingText(headEv);
              }
              return null;
            })()}
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {ticket.subject}
          </h1>

          <p className="text-xs text-slate-500">
            Opened by{" "}
            <span className="font-semibold text-slate-700">
              {ticket.requester_name}
            </span>
            {ticket.requester_company && (
              <>
                {" "}
                ·{" "}
                <span className="text-slate-700">
                  {ticket.requester_company}
                </span>
              </>
            )}
            <span className="text-slate-400">
              {" "}
              · last activity {lastActivityText}
            </span>
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {messages.map((msg) => {
              const isInternal = msg.visibility === "internal";
              const isCustomer = msg.author_type === "customer";

              return (
                <div key={msg.id} className="flex space-x-3 items-start">
                  <div
                    className={`w-8 h-8 rounded-full text-white flex items-center justify-center text-sm font-semibold shrink-0 ${
                      isCustomer
                        ? "bg-slate-600"
                        : isInternal
                          ? "bg-amber-600"
                          : "bg-teal-700"
                    }`}
                  >
                    {msg.author_initials || (isCustomer ? "AN" : "SO")}
                  </div>

                  <div className="flex-1 space-y-1">
                    <div className="flex items-center space-x-2 text-xs">
                      <span className="font-semibold text-slate-900">
                        {msg.author_name ||
                          (isCustomer ? "Aisha Noor" : "Sam Okafor")}
                      </span>
                      {isInternal && (
                        <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded border border-amber-200 tracking-wider uppercase">
                          Internal Note
                        </span>
                      )}
                      <span className="text-slate-400 text-xs">
                        {new Date(msg.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    <div
                      className={`p-3.5 rounded-lg text-sm leading-relaxed border ${
                        isInternal
                          ? "bg-amber-50 border-amber-200 text-slate-800"
                          : isCustomer
                            ? "bg-white border-slate-200 text-slate-800 shadow-sm"
                            : "bg-emerald-50/50 border-emerald-200 text-slate-800"
                      }`}
                    >
                      <MentionText text={msg.body} />
                    </div>
                  </div>
                </div>
              );
            })}

            <div
              className={`rounded-xl border overflow-hidden transition-colors ${
                replyType === "internal"
                  ? "bg-amber-50 border-amber-200"
                  : "bg-white border-slate-200"
              }`}
            >
              <div className="flex items-center space-x-2 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setReplyType("public")}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-all ${
                    replyType === "public"
                      ? "border-teal-700 text-teal-700 bg-teal-700/10 shadow-sm ring-1 ring-teal-700"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Public reply
                </button>
                <button
                  type="button"
                  onClick={() => setReplyType("internal")}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-all ${
                    replyType === "internal"
                      ? "border-amber-600 text-amber-800 bg-amber-100/50 shadow-sm ring-1 ring-amber-600"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Internal note
                </button>
              </div>

              <div className="px-4 sm:px-6 py-3 relative min-h-30">
                <textarea
                  rows={4}
                  value={replyText}
                  onChange={(e) => handleReplyTextChange(e.target.value)}
                  placeholder={
                    replyType === "internal"
                      ? "Visible to your team only — context, root cause, next steps."
                      : `Write a reply to ${ticket.requester_name || "John Doe"}...`
                  }
                  className="w-full bg-transparent text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 border-none outline-none focus:outline-none focus:ring-0 focus-visible:ring-0 p-0 resize-none"
                />
                {mentionActive && mentionMatches.length > 0 && (
                  <div
                    ref={mentionRef}
                    className="absolute z-30 top-10 left-4 sm:left-6 mt-1 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
                  >
                    <p className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Mention someone
                    </p>
                    <div className="max-h-48 overflow-y-auto">
                      {mentionMatches.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyMention(member);
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">
                              {member.full_name
                                .split(" ")
                                .map((s) => s[0])
                                .join("")
                                .slice(0, 2)
                                .toUpperCase()}
                            </span>
                            <span className="truncate text-xs font-medium text-slate-800">
                              {member.full_name}
                            </span>
                          </span>
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold capitalize text-slate-500">
                            {member.role.replace("_", " ")}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {pendingFiles.length > 0 && (
                <div className="px-4 pb-3 flex flex-wrap gap-2">
                  {pendingFiles.map((file, i) => (
                    <div
                      key={`${file.name}-${i}`}
                      className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-md pl-2 pr-1 py-1 text-[11px] font-medium text-slate-700 shadow-sm"
                    >
                      <span className="w-4 h-4 rounded bg-slate-100 flex items-center justify-center text-[8px] font-bold text-slate-500 shrink-0">
                        {fileExtension(file.name).slice(0, 3)}
                      </span>
                      <span className="truncate max-w-30">{file.name}</span>
                      <span className="text-slate-400 text-[10px] shrink-0">
                        {formatSize(file.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePendingFile(i)}
                        className="text-slate-400 hover:text-slate-700 ml-1 shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="px-4 py-3 flex items-center justify-between gap-2 border-t border-transparent ring-0">
                <div className="flex items-center space-x-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFilesSelected}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 px-3 rounded-md"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="w-3.5 h-3.5 mr-1.5 text-slate-600" />
                    Attach
                  </Button>
                  <span className="text-xs text-slate-400">
                    {replyType === "internal"
                      ? "Not sent to the customer."
                      : "Sends by email and shows on the portal."}
                  </span>
                </div>

                <Button
                  size="sm"
                  onClick={handleSendReply}
                  disabled={
                    isPending ||
                    (!replyText.trim() && pendingFiles.length === 0)
                  }
                  className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold px-4 h-11 rounded-lg transition-colors shadow-sm"
                >
                  {isPending && (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  )}
                  {replyType === "internal"
                    ? "Add internal note"
                    : "Send public reply"}
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <Card className="shadow-sm border-slate-200 bg-white ring-0">
              <CardContent className="p-5 space-y-4 text-xs">
                <div className="flex items-center space-x-3 pb-3 border-b border-slate-100">
                  <div className="w-9 h-9 rounded-full bg-slate-500 text-white flex items-center justify-center text-xs font-bold">
                    {ticket.requester_name
                      .split(" ")
                      .map((s) => s[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase() || "CU"}
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

                <div className="grid gap-2">
                  <Label
                    htmlFor="status"
                    className="font-semibold text-slate-700"
                  >
                    Status
                  </Label>
                  <Select
                    value={status}
                    onValueChange={handleStatusChange}
                    disabled={isPending}
                  >
                    <SelectTrigger
                      id="status"
                      className="h-9 w-full text-xs bg-white border-slate-200"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      side="bottom"
                      align="start"
                      position="popper"
                    >
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="on_hold">On hold</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label
                    htmlFor="priority"
                    className="font-semibold text-slate-700"
                  >
                    Priority
                  </Label>
                  <Select
                    value={priority}
                    onValueChange={handlePriorityChange}
                    disabled={isPending}
                  >
                    <SelectTrigger
                      id="priority"
                      className="h-9 w-full text-xs bg-white border-slate-200"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      side="bottom"
                      align="start"
                      position="popper"
                    >
                      <SelectItem value="urgent">Urgent</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label
                    htmlFor="assignee"
                    className="font-semibold text-slate-700"
                  >
                    Assignee
                  </Label>
                  <Select
                    value={assigneeId}
                    onValueChange={handleAssigneeChange}
                    disabled={isPending}
                  >
                    <SelectTrigger
                      id="assignee"
                      className="h-9 w-full text-xs bg-white border-slate-200"
                    >
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent
                      side="bottom"
                      align="start"
                      position="popper"
                    >
                      {currentUserId && (
                        <SelectItem value="me">Assign to me</SelectItem>
                      )}
                      {agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.full_name}
                        </SelectItem>
                      ))}
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label className="font-semibold text-slate-700">Tags</Label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ticket.tags && ticket.tags.length > 0 ? (
                      ticket.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="bg-slate-100 text-slate-700 font-medium text-[11px] px-2 py-0.5"
                        >
                          {tag}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-[11px] text-slate-400">
                        No tags
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-slate-200 bg-white ring-0">
              <CardContent className="p-5 space-y-4 text-xs">
                <h4 className="font-bold uppercase tracking-wider text-[11px] text-slate-400">
                  SLA
                </h4>

                {slaEvents.length === 0 ? (
                  <p className="text-[11px] text-slate-400">
                    No SLA policy assigned to this ticket.
                  </p>
                ) : (
                  slaEvents.map((ev) => {
                    const label =
                      ev.type === "first_response"
                        ? "First response"
                        : "Resolution";
                    const statusText =
                      ev.status === "completed"
                        ? `Completed · ${formatClock(ev.completed_at) ?? "—"}`
                        : ev.status === "breached"
                          ? `Breached · ${formatClock(ev.breached_at) ?? formatClock(ev.due_at) ?? "—"}`
                          : slaRemainingText(ev);
                    return (
                      <div
                        key={ev.id}
                        className="space-y-1.5 rounded-lg  border-slate-100 bg-slate-50/50 px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-600">
                            {label}
                          </span>
                          <span
                            className={cn(
                              "text-xs font-semibold",
                              slaRemainingTone(ev),
                            )}
                          >
                            {statusText}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-200/70 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${slaBarColor(ev)} transition-all`}
                            style={{ width: `${slaProgressPercent(ev)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm border-slate-200 bg-white ring-0">
              <CardContent className="p-5 space-y-3 text-xs">
                <h4 className="font-bold uppercase tracking-wider text-[11px] text-slate-400">
                  Attachments
                </h4>

                {attachments.length === 0 ? (
                  <p className="text-[11px] text-slate-400">
                    No attachments on this ticket.
                  </p>
                ) : (
                  <div className="space-y-2">
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
    </div>
  );
}
