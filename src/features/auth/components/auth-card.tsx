import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5.5 px-5 py-7 md:px-6 md:py-14">
      <Link href="/" className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex size-8.5 shrink-0 items-center justify-center rounded-md bg-brand-accent text-base font-extrabold text-brand-accent-foreground"
        >
          {"test".charAt(0).toUpperCase()}
        </span>

        <span className="text-lg font-bold tracking-tight text-foreground">
          ServiceDesk Pro
        </span>
      </Link>

      {children}
    </main>
  );
}

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
