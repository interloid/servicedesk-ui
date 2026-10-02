"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** How long the tick stays before the copy icon comes back. */
const COPIED_MS = 2000;

/**
 * Copies `value` and holds `copied` true for a moment afterwards, so the
 * control that was clicked confirms it, not only the toast. The value is
 * always on screen, so a refused clipboard points there rather than just
 * reporting failure.
 */
function useCopy(value: string, label: string) {
  const [copied, setCopied] = useState(false);
  // Set after the first copy, so the copy icon only animates on its way back
  // from the tick and not on first paint.
  const [used, setUsed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied to your clipboard.`);
      setCopied(true);
      setUsed(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      toast.error("We couldn't copy that. Select the text and copy it.");
    }
  }

  const action = copied ? `${label} copied` : `Copy ${label.toLowerCase()}`;

  return { copied, used, copy, action };
}

/** A square copy control for one value on the customer page. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const { copied, used, copy, action } = useCopy(value, label);

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn(
        "size-9 shrink-0 transition-colors active:scale-95",
        copied &&
          "border-emerald-300 bg-emerald-50 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-600 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
      )}
      aria-label={action}
      title={action}
      onClick={copy}
    >
      {/* Keyed so each swap remounts the icon and replays its entrance. */}
      {copied ? (
        <Check
          key="check"
          aria-hidden
          strokeWidth={2.5}
          className="size-4 animate-in zoom-in-50 fade-in duration-200"
        />
      ) : (
        <Copy
          key="copy"
          aria-hidden
          className={cn(
            "size-4",
            used && "animate-in zoom-in-75 fade-in duration-200",
          )}
        />
      )}
    </Button>
  );
}

/**
 * The value itself as the copy target, for one worth copying straight from
 * the text (the portal link). A copy icon shows on hover and turns into a
 * tick with "Copied" once it lands.
 */
export function CopyText({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { copied, used, copy, action } = useCopy(value, label);

  return (
    <button
      type="button"
      title={action}
      onClick={copy}
      className={cn(
        "group/copy cursor-pointer text-left break-all underline-offset-4 transition-opacity hover:underline focus-visible:rounded-sm focus-visible:underline focus-visible:outline-none active:opacity-70",
        className,
      )}
    >
      {value}
      {/* aria-live so the confirmation is read out as well as seen. */}
      <span aria-live="polite" className="ml-1.5 inline-flex align-middle">
        {copied ? (
          <span
            key="check"
            className="inline-flex -translate-y-px items-center gap-1 text-xs font-semibold text-emerald-600 animate-in zoom-in-75 fade-in duration-200 dark:text-emerald-300"
          >
            <Check aria-hidden strokeWidth={2.5} className="size-3.5" />
            Copied
          </span>
        ) : (
          <Copy
            key="copy"
            aria-hidden
            className={cn(
              "size-3.5 -translate-y-px opacity-0 transition-opacity duration-200 group-hover/copy:opacity-70 group-focus-visible/copy:opacity-70 motion-reduce:transition-none",
              used && "animate-in fade-in",
            )}
          />
        )}
      </span>
    </button>
  );
}
