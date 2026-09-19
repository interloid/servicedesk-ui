import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

type NoticeTone = "accent" | "amber" | "neutral";

const TONES: Record<
  NoticeTone,
  { box: string; tile: string; icon: string; title: string; body: string }
> = {
  accent: {
    box: "border-brand-accent/20 bg-brand-accent/3",
    tile: "bg-brand-accent/10 text-brand-accent",
    icon: "text-brand-accent",
    title: "text-foreground",
    body: "text-muted-foreground",
  },
  amber: {
    box: "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30",
    tile: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    icon: "text-amber-600 dark:text-amber-400",
    title: "text-amber-900 dark:text-amber-200",
    body: "text-amber-800/90 dark:text-amber-300/90",
  },
  neutral: {
    box: "border-border bg-muted/40",
    tile: "bg-muted text-muted-foreground",
    icon: "text-muted-foreground",
    title: "text-foreground",
    body: "text-muted-foreground",
  },
};

/**
 * The explanatory block every billing popup opens with.
 *
 * Two alignments, one rule: a block with a title puts its icon tile and title
 * on one row and runs the body full width underneath, so long copy wraps to the
 * block's own left edge instead of hanging off the title. A block without a
 * title keeps the icon beside its text. Every popup used to align these its own
 * way -- some indented, some not, some with a tile and some without.
 */
export function ModalNotice({
  icon: Icon,
  tone = "accent",
  title,
  children,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  tone?: NoticeTone;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const styles = TONES[tone];

  return (
    <div
      className={cn(
        "w-full rounded-xl border px-4 py-3.5 text-left text-sm leading-5",
        styles.box,
        className,
      )}
    >
      {title ? (
        <>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg",
                styles.tile,
              )}
            >
              <Icon className="size-4.5" />
            </span>
            <p className={cn("font-semibold", styles.title)}>{title}</p>
          </div>
          <div className={cn("mt-2.5 font-normal", styles.body)}>
            {children}
          </div>
        </>
      ) : (
        <div className="flex items-start gap-3">
          <Icon className={cn("mt-0.5 size-5 shrink-0", styles.icon)} />
          <div className={cn("font-normal", styles.body)}>{children}</div>
        </div>
      )}
    </div>
  );
}
