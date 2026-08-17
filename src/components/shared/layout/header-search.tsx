"use client";

import * as React from "react";
import { Search, X } from "lucide-react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

export function HeaderSearch({ className }: { className?: string }) {
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

 
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
        return;

      const target = event.target as HTMLElement | null;
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
