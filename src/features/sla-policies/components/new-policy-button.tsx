"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const NEW_POLICY_BUTTON =
  "inline-flex h-10 items-center gap-2 self-start rounded-lg bg-brand-accent px-4 text-sm font-semibold text-brand-accent-foreground transition-colors hover:bg-brand-accent/90";

/**
 * "New policy" on the SLA list. With `disabledReason` set (the plan is full)
 * it stays visible but inert, and the tooltip says why.
 */
export function NewPolicyButton({
  href,
  disabledReason,
}: {
  href: string;
  disabledReason: string | null;
}) {
  if (disabledReason === null) {
    return (
      <Link href={href} className={NEW_POLICY_BUTTON}>
        <Plus className="size-4" aria-hidden />
        New policy
      </Link>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-disabled
            onClick={(event) => event.preventDefault()}
            className={`${NEW_POLICY_BUTTON} cursor-not-allowed opacity-60 hover:bg-brand-accent`}
          >
            <Plus className="size-4" aria-hidden />
            New policy
          </button>
        </TooltipTrigger>

        <TooltipContent side="bottom" className="max-w-xs">
          {disabledReason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
