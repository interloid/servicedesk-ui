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
import {
  ChevronLeft,
  Paperclip,
  Loader2,
  X,
  UserPlus,
  CheckCircle2,
} from "lucide-react";
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
import { toast } from "sonner";

interface TicketDetailViewProps {
  ticket: Ticket;
  messages: TicketMessage[];
  attachments?: TicketAttachment[];
  slaEvents?: SlaEvent[];
  tenantslug: string;
  agents?: AssignableAgent[];
  currentUserId?: string | null;
}

export default function TicketDetailView({
  ticket,
  messages = [],
  attachments = [],
  slaEvents = [],
  tenantslug: tenant,
  agents = [],
  currentUserId = null,
}: TicketDetailViewProps) {
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

  const formatTime = (iso?: string | null) =>
    iso
      ? new Date(iso).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  const slaProgress = (ev: SlaEvent, now: number) => {
    const start = new Date(ev.created_at).getTime();
    const due = new Date(ev.due_at).getTime();

    if (ev.status === "completed") return 100;
    if (ev.status === "breached") return 100;

    const total = due - start;
    if (total <= 0) return 100;

    const elapsed = ((now - start) / total) * 100;
    return Math.max(0, Math.min(100, Math.round(elapsed)));
  };

  const slaStatusColor = (ev: SlaEvent, now: number) => {
    if (ev.status === "breached") return "bg-red-500";
    if (ev.status === "completed") return "bg-emerald-500";
    const pct = slaProgress(ev, now);
    if (pct >= 100) return "bg-red-500";
    if (pct >= 75) return "bg-amber-400";
    return "bg-sky-500";
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

  const handleAssignToMe = () => {
    startTransition(async () => {
      const res = await assignTicketToMeAction({
        ticketId: ticket.id,
        tenantId: tenant,
      });
      if (res.success && res.assigneeId) {
        setAssigneeId(res.assigneeId);
      } else {
        toast.error(res.error || "Failed to assign ticket to you.");
      }
    });
  };

  const handleMarkSolved = () => {
    const prev = status;
    setStatus("resolved");
    startTransition(async () => {
      const res = await updateTicketDetailsAction({
        ticketId: ticket.id,
        tenantId: tenant,
        status: "resolved",
      });
      if (!res.success) {
        setStatus(prev);
        toast.error(res.error || "Failed to mark ticket as resolved.");
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
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
              {humanizeStatus(ticket.status)}
            </span>
            <span className="text-slate-400">
              Opened{" "}
              {new Date(ticket.created_at).toLocaleString([], {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
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
          </p>

          {status !== "resolved" && status !== "closed" && (
            <div className="flex items-center space-x-2 pt-1">
              <Button
                type="button"
                size="sm"
                disabled={isPending}
                onClick={handleAssignToMe}
                className="h-8 text-xs font-semibold bg-[#0d7a6a] hover:bg-[#095b4f] text-white shadow-none rounded-md px-3"
              >
                {isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <UserPlus className="w-3.5 h-3.5 mr-1.5" />
                )}
                Assign to me
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={handleMarkSolved}
                className="h-8 text-xs font-semibold border-slate-200 text-slate-700 bg-white hover:bg-slate-50 shadow-none rounded-md px-3"
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                Mark solved
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {messages.map((msg) => {
              const isInternal = msg.visibility === "internal";
              return (
                <div key={msg.id} className="flex space-x-3">
                  <div
                    className={`w-8 h-8 rounded-full ${
                      msg.author_type === "customer"
                        ? "bg-slate-500"
                        : "bg-emerald-700"
                    } text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5`}
                  >
                    {msg.author_initials ||
                      (msg.author_type === "customer" ? "CU" : "AG")}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center space-x-2 text-xs">
                      <span className="font-bold text-slate-900">
                        {msg.author_name ||
                          (msg.author_type === "customer"
                            ? "Customer"
                            : "Agent")}
                      </span>
                      {isInternal && (
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0 border-none">
                          Internal Note
                        </Badge>
                      )}
                      <span className="text-slate-400">
                        {new Date(msg.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    <div
                      className={`p-4 rounded-xl text-xs leading-relaxed border ${
                        isInternal
                          ? "bg-amber-50/60 border-amber-200/80 text-slate-800"
                          : "bg-white border-slate-200/80 text-slate-800 shadow-sm"
                      }`}
                    >
                      {msg.body}
                    </div>
                  </div>
                </div>
              );
            })}

            <Card className="shadow-sm border border-slate-200 overflow-hidden bg-white mt-6 rounded-lg w-full">
              <CardContent className="p-0">
                <div className="flex items-center space-x-2 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-100">
                  <button
                    type="button"
                    onClick={() => setReplyType("public")}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                      replyType === "public"
                        ? "border border-[#0d7a6a]/30 text-[#0d7a6a] bg-[#0d7a6a]/5"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Public reply
                  </button>
                  <button
                    type="button"
                    onClick={() => setReplyType("internal")}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                      replyType === "internal"
                        ? "border border-amber-500/30 text-amber-800 bg-amber-50"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Internal note
                  </button>
                </div>

                <div className="p-3 sm:p-4">
                  <Textarea
                    rows={4}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={
                      replyType === "internal"
                        ? "Write an internal note..."
                        : `Write a reply to ${ticket.requester_name || "customer"}...`
                    }
                    className="border-none shadow-none text-xs sm:text-sm focus-visible:ring-0 p-0 placeholder:text-slate-400 text-slate-800 w-full"
                  />
                </div>

                {pendingFiles.length > 0 && (
                  <div className="px-3 sm:px-4 pb-3 flex flex-wrap gap-2">
                    {pendingFiles.map((file, i) => (
                      <div
                        key={`${file.name}-${i}`}
                        className="inline-flex items-center gap-1.5 bg-slate-100 rounded-md pl-2 pr-1 py-1 text-[11px] font-medium text-slate-700 max-w-full"
                      >
                        <span className="w-4 h-4 rounded bg-white flex items-center justify-center text-[8px] font-bold text-slate-500 shrink-0">
                          {fileExtension(file.name).slice(0, 3)}
                        </span>
                        <span className="truncate max-w-30 sm:max-w-45">
                          {file.name}
                        </span>
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

                <div className="px-3 sm:px-4 py-3 bg-[#fafbfc] border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-2">
                  <div className="flex items-center space-x-2 sm:space-x-3">
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
                      className="h-8 text-xs font-semibold border-slate-200 text-slate-700 bg-white hover:bg-slate-50 shadow-none px-2.5 sm:px-3 shrink-0"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip className="w-3.5 h-3.5 sm:mr-1.5 text-slate-600" />
                      <span className="hidden sm:inline">Attach</span>
                    </Button>
                    <span className="text-[11px] sm:text-xs text-slate-400 truncate">
                      {replyType === "internal"
                        ? "Visible to team only."
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
                    className={`w-full sm:w-auto ${
                      replyType === "internal"
                        ? "bg-amber-600 hover:bg-amber-700"
                        : "bg-[#0d7a6a] hover:bg-[#095b4f]"
                    } text-white text-xs font-medium px-4 h-8 rounded-md transition-colors shrink-0`}
                  >
                    {isPending && (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    )}
                    Send{" "}
                    {replyType === "internal"
                      ? "internal note"
                      : "public reply"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="shadow-sm border-slate-200 bg-white">
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

                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-700">Status</label>
                  <Select
                    value={status}
                    onValueChange={handleStatusChange}
                    disabled={isPending}
                  >
                    <SelectTrigger className="h-9 w-full text-xs bg-white border-slate-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="on_hold">On hold</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-700">
                    Priority
                  </label>
                  <Select
                    value={priority}
                    onValueChange={handlePriorityChange}
                    disabled={isPending}
                  >
                    <SelectTrigger className="h-9 w-full text-xs bg-white border-slate-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="urgent">Urgent</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-700">
                    Assignee
                  </label>
                  <Select
                    value={assigneeId}
                    onValueChange={handleAssigneeChange}
                    disabled={isPending}
                  >
                    <SelectTrigger className="h-9 w-full text-xs bg-white border-slate-200">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
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

                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-700">Tags</label>
                  <div className="flex items-center space-x-1.5">
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

            <Card className="shadow-sm border-slate-200 bg-white">
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
                    const progress = slaProgress(ev, now);
                    const color = slaStatusColor(ev, now);
                    const label =
                      ev.type === "first_response"
                        ? "First response"
                        : "Resolution";
                    const statusLabel =
                      ev.status === "completed"
                        ? "Completed"
                        : ev.status === "breached"
                          ? "Breached"
                          : "Pending";
                    return (
                      <div key={ev.id} className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-600 font-medium">
                            {label}
                          </span>
                          <span className="font-bold text-slate-700">
                            {statusLabel}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[11px] text-slate-400">
                          <span>Due: {formatTime(ev.due_at) ?? "—"}</span>
                          <span>
                            {ev.status === "completed"
                              ? `at ${formatTime(ev.completed_at)}`
                              : ev.status === "breached"
                                ? `at ${formatTime(ev.breached_at)}`
                                : `${progress}% elapsed`}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${color} transition-all`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm border-slate-200 bg-white">
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
