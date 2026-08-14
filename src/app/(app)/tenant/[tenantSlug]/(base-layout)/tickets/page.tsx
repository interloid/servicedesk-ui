import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tickets",
  description: "Manage and track support tickets",
};

export default async function TicketsPage() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-semibold">Tickets</h1>

      <p className="text-sm text-foreground/70">
        The queue is a work in progress. It will eventually list all tickets
        for the current tenant, and allow creating new ones.
      </p>
    </div>
  );
}