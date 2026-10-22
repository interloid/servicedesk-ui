"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { stripTenantPrefix, tenantPath, TENANT_ROUTES } from "@/lib/tenancy";

/**
 * Searches the ticket queue: Enter opens the tickets list with ?search=, the
 * same param its own search box writes.
 */
export function HeaderSearch({
  className,
  autoFocus = false,
  shortcut = true,
  onSearch,
}: {
  className?: string;
  autoFocus?: boolean;
  /** Off for a second copy (the mobile popover), so "/" is bound once. */
  shortcut?: boolean;
  /** After navigating, e.g. to close the popover holding it. */
  onSearch?: () => void;
}) {
  const [query, setQuery] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  // Below lg the box is display:none; "/" then stays an ordinary key.
  useKeyboardShortcut(
    "/",
    () => {
      const input = inputRef.current;
      if (!input || input.getClientRects().length === 0) return false;
      input.focus();
    },
    shortcut,
  );

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const term = query.trim();
    const parsed = stripTenantPrefix(pathname);
    if (!term || !parsed) return;

    router.push(
      `${tenantPath(parsed.slug, TENANT_ROUTES.TICKETS)}?search=${encodeURIComponent(term)}`,
    );
    inputRef.current?.blur();
    onSearch?.();
  };

  return (
    <form role="search" onSubmit={onSubmit} className="contents">
      <InputGroup className={className}>
        <InputGroupAddon align="inline-start" className="pl-3">
          <Search
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </InputGroupAddon>

        <InputGroupInput
          ref={inputRef}
          type="search"
          aria-label="Search tickets"
          placeholder="Search tickets"
          autoFocus={autoFocus}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="text-sm [&::-webkit-search-cancel-button]:appearance-none"
        />

        <InputGroupAddon align="inline-end" className="pr-2">
          {query ? (
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              <X aria-hidden />
            </InputGroupButton>
          ) : shortcut ? (
            <kbd className="rounded-sm border border-border bg-card px-1.5 py-0.5 font-mono text-xs leading-none text-muted-foreground">
              /
            </kbd>
          ) : null}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
