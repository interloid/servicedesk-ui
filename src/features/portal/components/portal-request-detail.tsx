"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleAlert,
  Download,
  Loader2,
  Lock,
  Paperclip,
  RotateCcw,
  SendHorizontal,
} from "lucide-react";

import { BackLink } from "@/components/shared/back-link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  discardUploadsAction,
  postReplyAction,
  prepareReplyUploadsAction,
  reopenRequestAction,
} from "@/features/portal/actions/portal.actions";
import { PortalAttachmentPicker } from "@/features/portal/components/portal-attachment-picker";
import { PortalCsatCard } from "@/features/portal/components/portal-csat-card";
import { portalToastSuccess } from "@/features/portal/portal-toast";
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
import { prepareAndUpload } from "@/features/portal/upload";
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

  const threadRef = useRef<HTMLDivElement>(null);
  const lastMessageId = request.messages.at(-1)?.id;

  // Opens on the newest message and follows the thread when a reply lands, as
  // a chat does. Keyed on the last message rather than on every render, so a
  // customer scrolled up to reread something is not yanked back down while
  // typing. Layout effect, so the first paint is already at the bottom rather
  // than flashing the top of the thread first.
  useLayoutEffect(() => {
    const thread = threadRef.current;

    if (thread) {
      thread.scrollTop = thread.scrollHeight;
    }
  }, [lastMessageId, request.csat.resolvedAt]);

  /**
   * The reply's files go straight to Storage first; the reply then names the
   * paths that landed. They cannot travel with the action itself -- a Server
   * Action body is capped well below any useful attachment size.
   */
  function discard(paths: string[]): Promise<void> {
    return discardUploadsAction(tenantSlug, paths, request.id);
  }

  function uploadFiles(): Promise<PortalUploadedFile[]> {
    return prepareAndUpload(
      files,
      (descriptors) =>
        prepareReplyUploadsAction(tenantSlug, request.id, descriptors),
      discard,
    );
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
        // The files landed but the reply was refused, so nothing will ever
        // reference them. Paths already filed are skipped server-side.
        void discard(uploads.map((upload) => upload.path));
        setError(result.message);
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

      // The Alert above the composer says it; no toast on top (RISK-047).
      setError(message);
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
  }

  const { created, updated } = describeHeader(request);

  return (
    // Laid out like a chat window: one card the height of the screen, with the
    // request's header pinned at the top, the composer pinned at the bottom,
    // and only the thread between them scrolling. The height is the viewport
    // less the portal header (h-15 / sm:h-16 plus its border) and <main>'s
    // vertical padding (py-8 / md:py-12), so the card ends where the screen
    // does, less the back link's 2.25rem (a 20px line and mt-4 under it).
    // min-h keeps a short landscape phone from squeezing the thread to
    // nothing -- there the page scrolls instead.
    <div className="mx-auto flex h-[calc(100dvh-10.125rem)] min-h-120 w-full max-w-7xl flex-col sm:h-[calc(100dvh-10.3125rem)] md:h-[calc(100dvh-12.3125rem)] md:px-6">
      <BackLink href={portalPath(tenantSlug, PORTAL_ROUTES.REQUESTS)}>
        Your requests
      </BackLink>

      <section
        className={cn(CHAT_CARD_CLASS, "mt-4 flex min-h-0 flex-1 flex-col")}
      >
        <header className="flex shrink-0 items-start gap-3 border-b px-4 py-3.5 sm:gap-4 sm:px-6 sm:py-4">
          <div className="min-w-0 flex-1">
            {/* One line, ellipsised, as a chat title is: the header has to stay
                one fixed height for the thread under it to keep its room, and
                the full subject is a hover away. */}
            <h1
              title={request.subject}
              className="truncate text-base font-bold tracking-tight text-foreground sm:text-lg"
            >
              {request.subject}
            </h1>

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-foreground tabular-nums">
                #{request.number ?? "-"}
              </span>

              {/* No leading dot, same as the list badge: the label already
                  says the state, and a 6px dot inside a bordered pill reads as
                  a second, smaller pill. */}
              <span
                className={cn(
                  "whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                  STATE_BADGE[request.state],
                )}
              >
                {PORTAL_STATE_LABEL[request.state]}
              </span>

              <span
                suppressHydrationWarning
                className="text-xs text-muted-foreground md:hidden"
              >
                {updated}
              </span>
            </div>
          </div>

          <div
            suppressHydrationWarning
            className="hidden shrink-0 flex-col items-end gap-0.5 pt-0.5 text-xs text-muted-foreground md:flex"
          >
            <span suppressHydrationWarning>{created}</span>
            <span suppressHydrationWarning>{updated}</span>
          </div>
        </header>

        {/* The only part that scrolls. A conversation, laid out as one: the
            customer's own messages sit on the right and the team's on the
            left, so a reply reads as an answer rather than as another entry in
            a log. */}
        <div
          ref={threadRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6"
        >
          <div className="flex flex-col">
            {request.messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
          </div>

          {/* At the end of the thread, as the latest thing that happened to
              the request. The thread opens scrolled to the bottom, so this is
              what a customer lands on once the request is resolved. */}
          {request.csat.resolvedAt ? (
            <div className="mx-auto mt-8 w-full max-w-xl">
              <PortalCsatCard
                tenantSlug={tenantSlug}
                requestId={request.id}
                csat={request.csat}
              />
            </div>
          ) : null}
        </div>

        {/* Pinned under the thread, as a chat composer is: the customer can
            answer whatever they just read without scrolling for the box. */}
        <footer className="shrink-0 border-t bg-muted/30 px-3 py-3 sm:px-6 sm:py-4">
          {error ? (
            <Alert
              variant="destructive"
              className="mb-3 rounded-[10px] px-3.5 py-3"
            >
              <CircleAlert className="size-4.5" aria-hidden />
              <AlertDescription className="text-sm leading-[1.55]">
                {error}
              </AlertDescription>
            </Alert>
          ) : null}

          <label htmlFor="portal-reply" className="sr-only">
            Reply to this request
          </label>

          <Textarea
            id="portal-reply"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={busy}
            rows={2}
            placeholder="Write your reply…"
            className="min-h-11 max-h-32 resize-none overflow-y-auto rounded-xl bg-background text-sm leading-6 sm:min-h-14 sm:max-h-40"
          />

          {/* One row of controls under the box, as a chat composer has: on a
              phone, stacking Attach, the limits, Reopen and Send one per row
              took a third of the screen from the thread. The picker's own
              wrapper is `contents`, so its trigger sits in this row and its
              file list drops onto a full-width line beneath it. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 sm:mt-3 sm:gap-2.5">
            <PortalAttachmentPicker
              files={files}
              onChange={setFiles}
              onError={setError}
              disabled={busy}
              compact
              className="contents"
              listClassName="order-last basis-full"
            />

            <div className="ml-auto flex shrink-0 gap-1.5 sm:gap-2.5">
              {canReopen(request.state) ? (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="h-11 px-3 font-semibold sm:px-5"
                  onClick={() => void reopen()}
                  disabled={busy}
                >
                  {isReopening ? (
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw aria-hidden className="size-4" />
                  )}
                  {isReopening ? "Reopening…" : "Reopen"}
                  {isReopening ? null : (
                    <span className="max-sm:hidden"> request</span>
                  )}
                </Button>
              ) : null}

              <Button
                type="button"
                size="lg"
                className="h-11 px-4 font-semibold sm:px-5"
                onClick={() => void sendReply()}
                disabled={busy || !body.trim()}
              >
                {isSending ? (
                  "Sending…"
                ) : (
                  <span>
                    Send<span className="max-sm:hidden"> reply</span>
                  </span>
                )}
                {isSending ? (
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                ) : (
                  <SendHorizontal aria-hidden className="size-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Hidden on a phone, where every line here is a line taken from
              the thread; the request is just as private without the note. */}
          <p className="mt-2.5 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <Lock aria-hidden className="size-3.5 shrink-0" />
            Only you and the {tenantName} team can see this
          </p>
        </footer>
      </section>
    </div>
  );
}

/**
 * The one card on the page, holding header, thread and composer together as a
 * single chat window. overflow-hidden so the rounded corners clip the pinned
 * header and composer backgrounds.
 */
const CHAT_CARD_CLASS =
  "overflow-hidden rounded-2xl border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.05)]";

/**
 * One entry in the thread. The customer reads their own messages on the right
 * and the team's on the left, so a thread reads as a conversation without any
 * labels: which side a message is on is the fact the eye needs first.
 *
 * Three details carry the layout, and all three are about one message never
 * sitting on top of the next. min-w-0 on the header and the bubble lets both
 * shrink inside the flex column, which is what stops a long unbroken word or
 * a long filename pushing the bubble out of the page and over its neighbour --
 * a flex item's default min-width:auto does not shrink, and that is the whole
 * cause. max-w-* then caps the bubble short of the opposite side, so the two
 * sides stay visibly two sides. And the vertical rhythm is padding on the
 * article with no negative margin anywhere, so nothing can be pulled up over
 * the message above it.
 */
function Message({ message }: { message: PortalMessage }) {
  const fromTeam = message.authorType !== "customer";
  const fromCustomer = message.authorType === "customer";

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col gap-2 py-4 first:pt-0 last:pb-0",
        fromCustomer ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2.5",
          fromCustomer && "flex-row-reverse",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
            fromTeam
              ? "bg-brand-accent text-brand-accent-foreground"
              : // Ringed because the customer's bubble below is the same tint:
                // without an edge the two read as one soft block on the right.
                "bg-brand-accent/10 text-brand-accent ring-1 ring-brand-accent/25 ring-inset",
          )}
        >
          {message.initials}
        </span>

        <div
          className={cn(
            "min-w-0",
            fromCustomer && "flex flex-col items-end text-right",
          )}
        >
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

      <div
        className={cn(
          "min-w-0 max-w-[85%] rounded-2xl px-3.5 py-2.5 sm:max-w-[75%]",
          fromCustomer
            ? "rounded-tr-sm bg-brand-accent/10 text-foreground"
            : "rounded-tl-sm bg-muted text-foreground",
        )}
      >
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
          <li key={attachment.id} className="min-w-0">
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

                <span
                  title={attachment.name}
                  className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
                >
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
                <span
                  title={attachment.name}
                  className="min-w-0 flex-1 truncate"
                >
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
