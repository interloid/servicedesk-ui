import React from "react";
import { Construction } from "lucide-react";

interface ComingSoonProps {
  title: string;
  description?: string;
}

const DEFAULT_DESCRIPTION =
  "This workspace is still under construction. We're hard at work bringing this feature to life — check back soon.";

export function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <div className="flex min-h-full w-full items-center justify-center p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-md flex-col items-center rounded-2xl border border-border bg-card px-6 py-12 text-center shadow-sm">
        <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-brand-badge text-brand-accent">
          <Construction className="h-7 w-7" />
        </span>

        <h1 className="mt-6 text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {description ?? DEFAULT_DESCRIPTION}
        </p>
      </div>
    </div>
  );
}
