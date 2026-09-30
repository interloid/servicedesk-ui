"use client";

import { useRef, useState } from "react";
import { CloudUpload, FileImage, FileText, Paperclip, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  attachmentError,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "@/features/portal/portal";
import { portalToastError } from "@/features/portal/portal-toast";
import { cn } from "@/lib/utils";

/**
 * How the picker presents itself.
 *
 * `dropzone` is the panel on the request form -- it owns its own heading, so it
 * reads as the field it is. `button` is the compact one under the reply box,
 * where the composer already says what it is and a second heading would be
 * noise.
 */
type Variant = "dropzone" | "button";

/**
 * Picks files to send with a request or a reply.
 *
 * Holds `File` objects rather than uploading as they are chosen: nothing is
 * stored until the message it belongs to exists, so an abandoned draft leaves
 * no orphans in the bucket and no rows to reap.
 *
 * The limits it enforces are the same ones the server re-checks -- this side
 * exists to say "that file is too big" before the customer waits for an upload,
 * not to be the rule.
 */
export function PortalAttachmentPicker({
  files,
  onChange,
  onError,
  disabled,
  variant = "button",
  className,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  /** Called with a reason when a pick is refused, or undefined when it clears. */
  onError: (message?: string) => void;
  disabled?: boolean;
  variant?: Variant;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const full = files.length >= MAX_ATTACHMENTS_PER_MESSAGE;
  const locked = Boolean(disabled) || full;

  const limits = `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files · ${formatBytes(
    MAX_ATTACHMENT_BYTES,
  )} per file`;

  function add(picked: FileList | null) {
    if (!picked || picked.length === 0) {
      return;
    }

    onError(undefined);

    const next = [...files];
    // A drag can refuse several files at once, so the first reason is toasted
    // once at the end rather than one per file -- otherwise dropping five bad
    // files stacks five toasts over the form.
    let firstProblem: string | undefined;

    for (const file of Array.from(picked)) {
      if (next.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
        firstProblem ??= `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files at a time.`;
        onError(firstProblem);
        break;
      }

      const problem = attachmentError(file);

      if (problem) {
        firstProblem ??= problem;
        onError(problem);
        continue;
      }

      // Same name AND size AND timestamp: the browser lets you pick one file
      // twice, and a duplicate here becomes a duplicate in the thread.
      const already = next.some(
        (existing) =>
          existing.name === file.name &&
          existing.size === file.size &&
          existing.lastModified === file.lastModified,
      );

      if (!already) {
        next.push(file);
      }
    }

    onChange(next);

    // No network call here, so this is the one rejection the banner is not
    // enough for on its own: the file never reaches the server, and the form
    // still submits fine without it.
    if (firstProblem) {
      portalToastError(firstProblem);
    }

    // Cleared so re-picking the same file still fires a change event.
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function remove(index: number) {
    onError(undefined);
    onChange(files.filter((_, position) => position !== index));
  }

  function open() {
    if (!locked) {
      inputRef.current?.click();
    }
  }

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        disabled={locked}
        onChange={(event) => add(event.target.files)}
      />

      {variant === "dropzone" ? (
        // A dashed panel that does not accept a drop is a lie, so it takes one.
        <button
          type="button"
          disabled={locked}
          onClick={open}
          onDragOver={(event) => {
            if (locked) return;
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            if (locked) return;
            event.preventDefault();
            setIsDragging(false);
            add(event.dataTransfer.files);
          }}
          className={cn(
            "group w-full rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
            locked
              ? "cursor-not-allowed border-border bg-muted/20 opacity-70"
              : "border-border bg-muted/20 hover:border-brand-accent/40 hover:bg-brand-accent/5",
            isDragging && "border-brand-accent/60 bg-brand-accent/10",
          )}
        >
          <span
            aria-hidden
            className="mx-auto flex size-11 items-center justify-center rounded-full bg-brand-accent/10 text-brand-accent transition-transform group-hover:-translate-y-0.5"
          >
            <CloudUpload className="size-5" />
          </span>

          {full ? (
            <>
              <span className="mt-3 block text-sm font-semibold text-foreground">
                That&apos;s the limit
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Remove one to attach something else —{" "}
                {MAX_ATTACHMENTS_PER_MESSAGE} files maximum
              </span>
            </>
          ) : (
            <>
              <span className="mt-3 block text-sm text-foreground">
                Drag &amp; drop files here or{" "}
                <span className="font-semibold text-brand-ink">
                  click to browse
                </span>
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {limits}
              </span>
            </>
          )}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="font-bold"
            disabled={locked}
            onClick={open}
          >
            <Paperclip aria-hidden className="size-3.5" />
            Attach files
          </Button>

          <span className="text-xs text-muted-foreground">
            {full
              ? `${MAX_ATTACHMENTS_PER_MESSAGE} files is the limit`
              : limits}
          </span>
        </div>
      )}

      {files.length > 0 ? (
        <ul
          className={cn(
            "grid gap-2.5",
            variant === "dropzone" && "sm:grid-cols-2",
          )}
        >
          {files.map((file, index) => {
            const isImage = file.type.startsWith("image/");
            const FileIcon = isImage ? FileImage : FileText;

            return (
              <li
                key={`${file.name}-${file.size}-${file.lastModified}`}
                className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-xs"
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg",
                    isImage
                      ? "bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-300"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <FileIcon className="size-4.5" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {file.name}
                  </span>
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    {formatBytes(file.size)}
                  </span>
                </span>

                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => remove(index)}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50"
                >
                  <X aria-hidden className="size-4" />
                  <span className="sr-only">Remove {file.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
