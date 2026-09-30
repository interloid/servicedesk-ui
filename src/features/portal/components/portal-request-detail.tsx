"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CircleAlert,
  Download,
  Loader2,
  Lock,
  Paperclip,
  RotateCcw,
  SendHorizontal,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  postReplyAction,
  prepareReplyUploadsAction,
  reopenRequestAction,
} from "@/features/portal/actions/portal.actions";
import { PortalAttachmentPicker } from "@/features/portal/components/portal-attachment-picker";
import { PortalCsatCard } from "@/features/portal/components/portal-csat-card";
import {
  portalToastError,
  portalToastResult,
  portalToastSuccess,
} from "@/features/portal/portal-toast";
import {
  canReopen,
  formatBytes,
  PORTAL_ROUTES,
  PORTAL_STATE_LABEL,
  portalPath,
  type PortalAttachment,
  type PortalMessage,
  type PortalRequestDetail,
  type PortalRequestState,
  type PortalUploadedFile,
} from "@/features/portal/portal";
import { uploadToTargets } from "@/features/portal/upload";
import { cn } from "@/lib/utils";

/**
 * The state colours carry their own border rather than a neutral one: on a flat
 * page the badge is one of only two filled chips left, and a grey hairline round
 * a sky or emerald pill reads as a rendering fault rather than as a chip.
 */
const STATE_BADGE: Record<PortalRequestState, string> = {
  open: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  waiting_on_you:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  resolved:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
};

export function PortalRequestDetailView({
  tenantSlug,
  tenantName,
  request,
}: {
  tenantSlug: string;
  tenantName: string;
  request: PortalRequestDetail;
}) {
  const router = useRouter();

  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [isSending, setIsSending] = useState(false);
  const [isReopening, setIsReopening] = useState(false);

  const busy = isSending || isReopening;

  /**
   * The reply's files go straight to Storage first; the reply then names the
   * paths that landed. They cannot travel with the action itself -- a Server
   * Action body is capped well below any useful attachment size.
   */
  async function uploadFiles(): Promise<PortalUploadedFile[]> {
    if (files.length === 0) {
      return [];
    }

    const prepared = await prepareReplyUploadsAction(
      tenantSlug,
      request.id,
      files.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
      })),
    );

    if (!prepared.success) {
      throw new Error(prepared.message);
    }

    return uploadToTargets(prepared.data.targets, files);
  }

  async function sendReply() {
    // A reply with only files still needs a line of text: the thread renders
    // the body, and an empty bubble reads as a delivery failure.
    if (!body.trim() || busy) {
      return;
    }

    setError(undefined);
    setIsSending(true);

    try {
      const uploads = await uploadFiles();

      const result = await postReplyAction(
        tenantSlug,
        request.id,
        { body },
        uploads,
      );

      if (!result.success) {
        setError(result.message);
        portalToastResult(result);
        return;
      }

      setBody("");
      setFiles([]);
      // The thread is server-rendered, so refresh rather than appending
      // locally: the reply may also have moved the request out of
      // "Waiting on you", and the header has to agree with the thread.
      //
      // The toast earns its place here: clearing the box is the only local sign
      // the reply was sent, and the new bubble arrives with the refresh.
      // Says where the answer will arrive, since the alternative reading of a
      // portal is "check your email".
      portalToastSuccess("Reply sent - the answer comes back to this thread.");
      router.refresh();
    } catch (uploadFailure) {
      const message =
        uploadFailure instanceof Error
          ? uploadFailure.message
          : "We couldn't send that reply. Try again.";

      setError(message);
      portalToastError(message);
    } finally {
      setIsSending(false);
    }
  }

  async function reopen() {
    if (busy) {
      return;
    }

    setError(undefined);
    setIsReopening(true);

    const result = await reopenRequestAction(tenantSlug, request.id);

    setIsReopening(false);

    if (result.success) {
      // The badge changes with the refresh, but a status change is small enough
      // to miss, and the reply box reappearing is not an obvious "it's open".
      // Says the one thing they cannot see: reopening puts it back in the queue.
      portalToastSuccess("Reopened and back in the queue.");
      router.refresh();
      return;
    }

    setError(result.message);
    portalToastResult(result);
  }

  const { created, updated } = describeHeader(request);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Link
        href={portalPath(tenantSlug, PORTAL_ROUTES.REQUESTS)}
        className="inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-brand-ink underline-offset-4 hover:text-brand-ink hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Your requests
      </Link>

      {error ? (
        <Alert
          variant="destructive"
          className="mt-5 rounded-[10px] px-3.5 py-3"
        >
          <CircleAlert className="size-4.5" aria-hidden />
          <AlertDescription className="text-sm leading-[1.55]">
            {error}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* No card. This is a conversation, and a conversation does not arrive in
          a box: the page was three levels of nesting deep -- a card around the
          request, a card around every message inside it, a card around every
          attachment inside that -- and the outermost one was the only thing
          giving the thread its shape. Hairlines and space do that job without
          the pile. Only real controls keep an outline: the textarea, the
          buttons, the attachment rows. */}
      <section className="mt-4">
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-semibold text-foreground tabular-nums">
              #{request.number ?? "—"}
            </span>

            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
                STATE_BADGE[request.state],
              )}
            >
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              {PORTAL_STATE_LABEL[request.state]}
            </span>
          </div>

          <div
            suppressHydrationWarning
            className="flex flex-wrap gap-x-3 text-xs text-muted-foreground sm:flex-col sm:items-end sm:gap-0.5"
          >
            <span suppressHydrationWarning>{created}</span>
            <span suppressHydrationWarning>{updated}</span>
          </div>
        </div>

        <h1 className="mt-3 text-2xl font-bold tracking-tight text-balance wrap-break-word text-foreground sm:text-[1.75rem]">
          {request.subject}
        </h1>

        {/* Above the thread, as in the design: a resolved request is a moment
            to ask, and burying it under the conversation loses most
            responses. */}
        {request.csat.resolvedAt ? (
          <div className="mt-6 border-t pt-6">
            <PortalCsatCard
              tenantSlug={tenantSlug}
              requestId={request.id}
              csat={request.csat}
            />
          </div>
        ) : null}

        {/* divide-y, not a card per message: the rule between two replies is
            the whole of the separation, and the tint that used to mark the
            team apart is carried by the avatar and the "Support team" chip
            now that the box is gone. */}
        <div className="mt-6 flex flex-col divide-y divide-border">
          {request.messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}
        </div>
      </section>

      {/* The one card on the page. The thread above is flat because a
          conversation does not arrive in a box, but the composer is the only
          thing here anybody acts on, and boxing it says that without a heading
          having to shout it. */}
      <section className={cn(REPLY_CARD_CLASS, "mt-8")}>
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <label
            htmlFor="portal-reply"
            className="text-base font-bold text-foreground"
          >
            Reply to this request
          </label>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock aria-hidden className="size-3.5 shrink-0" />
            Only you and the {tenantName} team can see this
          </p>
        </div>

        <Textarea
          id="portal-reply"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={busy}
          rows={4}
          placeholder="Write your reply…"
          className="mt-3 min-h-28 resize-y rounded-xl bg-background/60 text-sm leading-6"
        />

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <PortalAttachmentPicker
            files={files}
            onChange={setFiles}
            onError={setError}
            disabled={busy}
            className="min-w-0 flex-1"
          />

          <div className="grid shrink-0 auto-cols-fr grid-flow-col gap-2.5 sm:flex">
            {canReopen(request.state) ? (
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 px-5 font-semibold"
                onClick={() => void reopen()}
                disabled={busy}
              >
                {isReopening ? (
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                ) : (
                  <RotateCcw aria-hidden className="size-4" />
                )}
                {isReopening ? "Reopening…" : "Reopen request"}
              </Button>
            ) : null}

            <Button
              type="button"
              size="lg"
              className="h-11 px-5 font-semibold"
              onClick={() => void sendReply()}
              disabled={busy || !body.trim()}
            >
              {isSending ? "Sending…" : "Send reply"}
              {isSending ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <SendHorizontal aria-hidden className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

const REPLY_CARD_CLASS =
  "rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.05)] sm:p-6";

function Message({ message }: { message: PortalMessage }) {
  const fromTeam = message.authorType !== "customer";

  return (
    // py-5 with the ends trimmed: the thread's divide-y supplies the rule
    // between messages, and this keeps the padding off the outer edges so the
    // first message sits as close to the subject as the last one does to the
    // reply box.
    <article className="py-5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
            fromTeam
              ? "bg-brand-accent text-brand-accent-foreground"
              : "bg-brand-accent/10 text-brand-accent",
          )}
        >
          {message.initials}
        </span>

        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold wrap-break-word text-foreground">
            {message.authorName}
            {fromTeam && message.authorType === "agent" ? (
              <span className="rounded-full bg-brand-accent/10 px-2 py-0.5 text-[11px] font-semibold text-brand-ink">
                Support team
              </span>
            ) : null}
          </p>
          <p suppressHydrationWarning className="text-xs text-muted-foreground">
            {formatStamp(message.createdAt)}
          </p>
        </div>
      </div>

      {/* Indented under the name on a wide screen, as in the design; full
          width on a phone, where 48px of indent is a lot of a line. */}
      <div className="mt-3 sm:pl-12">
        {/* Plain text, split on blank lines. Agent replies are not trusted
            markup and must never be rendered as HTML. */}
        {message.body.split(/\n{2,}/).map((paragraph, index) => (
          <p
            key={index}
            className={cn(
              "text-sm leading-[1.6] whitespace-pre-line wrap-break-word text-foreground",
              index > 0 && "mt-2.5",
            )}
          >
            {paragraph}
          </p>
        ))}

        {message.attachments.length > 0 ? (
          <AttachmentList attachments={message.attachments} />
        ) : null}
      </div>
    </article>
  );
}

function AttachmentList({ attachments }: { attachments: PortalAttachment[] }) {
  return (
    <ul className="mt-3 flex flex-col gap-1.5 border-t pt-3">
      {attachments.map((attachment) => {
        const label = `${attachment.name} (${formatBytes(attachment.size)})`;

        return (
          <li key={attachment.id}>
            {attachment.url ? (
              <a
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-2 rounded-lg border bg-background/60 px-3 py-2 transition-colors hover:bg-muted/60"
              >
                <Paperclip
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground"
                />

                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {attachment.name}
                </span>

                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatBytes(attachment.size)}
                </span>

                <Download
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                />

                <span className="sr-only">Download {label}</span>
              </a>
            ) : (
              // The row exists but the link could not be minted. Naming the
              // file is still worth more than hiding it: the customer knows
              // what they sent, and "try again" is honest about the cause.
              <span className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                <Paperclip aria-hidden className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {attachment.name}
                </span>
                <span className="shrink-0 text-xs">unavailable</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

function isToday(value: Date): boolean {
  const now = new Date();

  return (
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth() &&
    value.getDate() === now.getDate()
  );
}

function formatStamp(iso: string): string {
  const value = new Date(iso);

  return isToday(value)
    ? `Today, ${TIME_FORMAT.format(value)}`
    : `${DATE_FORMAT.format(value)}, ${TIME_FORMAT.format(value)}`;
}

function relative(value: Date): string {
  const minutes = Math.round((Date.now() - value.getTime()) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;

  return DATE_FORMAT.format(value);
}

function describeHeader(request: PortalRequestDetail): {
  created: string;
  updated: string;
} {
  const opened = new Date(request.createdAt);
  const created = `Created ${
    isToday(opened)
      ? `today, ${TIME_FORMAT.format(opened)}`
      : DATE_FORMAT.format(opened)
  }`;

  if (request.state === "resolved" && request.resolvedAt) {
    return {
      created,
      updated: `Resolved ${relative(new Date(request.resolvedAt))}`,
    };
  }

  return {
    created,
    updated: `Last updated ${relative(new Date(request.updatedAt))}`,
  };
}
