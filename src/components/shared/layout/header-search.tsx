"use client";

import * as React from "react";
import { Search, X } from "lucide-react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

/**
 * Global search, from `Update design.dc.html` → `gqWrap` / `gqField`.
 *
 * It is a real typeable <input>, not a palette trigger: the design binds
 * `value={{ gq }} onChange={{ onGq }}` on a borderless input inside a bordered field.
 * `InputGroup` is that structure exactly — bordered wrapper, inline-start icon,
 * inline-end addon, transparent control — so the treatment comes from ui/ rather than
 * from a hand-rolled div.
 *
 * Measured: 38px tall, 420px cap, 9px gap, 8px radius, 12px mono `/` keycap. The keycap
 * swaps for a clear button once there is a query, which is the design's `gqIdle`/`gqHas`
 * pair — both belong to the field itself.
 *
 * NOT built here: the results dropdown (`gqPanel`) the design opens once the query is
 * non-empty. Its structure is recorded in docs/SHELL-DIFF.md; it is a later phase.
 */
export function HeaderSearch({ className }: { className?: string }) {
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  // The design advertises `/` as the focus shortcut on the keycap and lists it in its
  // own shortcut sheet ("/" → "Focus search"), so the hint has to actually do something.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
        return;

      const target = event.target as HTMLElement | null;
      // Never steal the keystroke from somewhere the user is already typing.
      if (
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      event.preventDefault();
      inputRef.current?.focus();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <InputGroup className={className}>
      <InputGroupAddon align="inline-start" className="pl-3">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </InputGroupAddon>

      <InputGroupInput
        ref={inputRef}
        type="search"
        aria-label="Search"
        placeholder="Search tickets, people, invoices"
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
        ) : (
          <kbd className="rounded-sm border border-border bg-card px-1.5 py-0.5 font-mono text-xs leading-none text-muted-foreground">
            /
          </kbd>
        )}
      </InputGroupAddon>
    </InputGroup>
  );
}
