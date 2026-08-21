import type { ShellIdentity } from "@/lib/identity";

export function AppFooter({ identity }: { identity: ShellIdentity | null }) {
  return (
    <footer className="mx-auto flex w-full max-w-[2040px] flex-wrap items-center gap-3 border-t px-4 py-3 text-xs text-muted-foreground md:px-6 lg:px-8">
      <span>ServiceDesk Pro{identity ? ` · ${identity.org.name}` : ""}</span>
      <span aria-hidden>·</span>
      <span>Status</span>
      <span>Docs</span>
      <span>Keyboard shortcuts</span>
      <span className="ml-auto font-mono">v3.14</span>
    </footer>
  );
}
