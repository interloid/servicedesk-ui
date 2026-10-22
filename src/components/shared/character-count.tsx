import { cn } from "@/lib/utils";

/**
 * "9,412 / 10,000" under a composer, shown only once the text is near the
 * limit -- a counter on every keystroke is noise for a two-line reply.
 */
export function CharacterCount({
  length,
  max,
  className,
}: {
  length: number;
  max: number;
  className?: string;
}) {
  if (length < max * 0.9) return null;

  return (
    <p
      aria-live="polite"
      className={cn(
        "text-right text-[11px] tabular-nums",
        length >= max ? "font-medium text-red-600" : "text-slate-500",
        className,
      )}
    >
      {length.toLocaleString("en-US")} / {max.toLocaleString("en-US")}
    </p>
  );
}
