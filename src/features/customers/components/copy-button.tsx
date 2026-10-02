"use client";

import { Check, Copy } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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

type CopyState = ReturnType<typeof useCopy>;

const CopyContext = createContext<CopyState | null>(null);

/**
 * One copy state for a whole row, so the value's text and the button beside
 * it copy the same thing and the tick shows on the button whichever was
 * clicked.
 */
export function CopyScope({
  value,
  label,
  children,
}: {
  value: string;
  label: string;
  children: ReactNode;
}) {
  const state = useCopy(value, label);

  return <CopyContext.Provider value={state}>{children}</CopyContext.Provider>;
}

/**
 * The value's text as a second way to copy it, inside a CopyScope. Outside
 * one it is plain text.
 */
export function CopyTrigger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const scope = useContext(CopyContext);

  if (!scope) {
    return <span className={className}>{children}</span>;
  }

  return (
    <button
      type="button"
      title={scope.action}
      onClick={scope.copy}
      className={cn(
        "block cursor-pointer text-left break-all underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:underline focus-visible:outline-none active:opacity-70",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A square copy control for one value on the customer page. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const scope = useContext(CopyContext);
  const own = useCopy(value, label);
  // Inside a CopyScope the row's shared state drives the tick.
  const { copied, used, copy, action } = scope ?? own;

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
