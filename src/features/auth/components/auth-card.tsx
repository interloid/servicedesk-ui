import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The shared shell for every `(auth)` screen — login, signup, create-org, forgot-password.
 *
 * Both pieces are transcribed from `Update design.dc.html`: `authPad` for the page column
 * and `authCard` for the card. They lived as duplicated class strings in each form until
 * this extraction; the values are unchanged, so every screen's measured geometry is
 * identical before and after (440px cap, 16px radius, 32px padding, 18px gap, and the
 * 24/20px padding below md).
 *
 * The onboarding wizard deliberately does NOT use `AuthCard`: its `wizCard` is a different
 * measured treatment (620px cap, 30px padding, 20px gap).
 */

/** `authPad`: centred single column, 22px between the logo row and the card. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5.5 px-5 py-7 md:px-6 md:py-14">
      <div className="flex items-center gap-2.5">
        {/* 34px tile, 8px radius, 16px/800 glyph — larger than the shell's 32px tile. */}
        <span
          aria-hidden
          className="flex size-8.5 shrink-0 items-center justify-center rounded-md bg-brand-accent text-base font-extrabold text-brand-accent-foreground"
        >
          {"test".charAt(0).toUpperCase()}
        </span>
        <span className="text-lg font-bold tracking-tight text-foreground">
          ServiceDesk Pro
        </span>
      </div>

      {children}
    </main>
  );
}

/** `authCard`, rendered as the <form> itself so no wrapper element is added. */
export function AuthCard({
  className,
  ...props
}: React.ComponentProps<"form">) {
  return (
    <form
      noValidate
      className={cn(
        "flex w-full max-w-110 flex-col gap-4.5 rounded-2xl border bg-card px-5 py-6 shadow-[0_10px_30px_rgba(15,23,42,0.06)] md:p-8",
        className,
      )}
      {...props}
    />
  );
}
