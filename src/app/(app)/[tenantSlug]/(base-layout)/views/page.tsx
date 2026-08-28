import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Views",
  description: "Manage and track support views",
};

export default function ViewsPage() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-semibold">Views</h1>

      <p className="text-sm text-foreground/70">
        The queue is a work in progress. It will eventually list all tickets for
        the current tenant, and allow creating new ones.
      </p>
    </div>
  );
}
