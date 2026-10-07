"use client";

import React, { useMemo, useState } from "react";
import { ChevronDown, Search, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SlaCustomerOption } from "../types/types";
import type { PolicyScope } from "../scope-rules";

/**
 * Multi-select over the tenant's customers. Filters in the browser — the
 * editor loads up to SLA_CUSTOMER_PICKER_LIMIT of them.
 */
export function CustomerPicker({
  customers,
  value,
  onChange,
  invalid,
  taken,
  lockTaken,
}: {
  customers: SlaCustomerOption[];
  value: string[];
  onChange: (next: string[]) => void;
  invalid?: boolean;
  /** Customer id → the other active policy that already has them. */
  taken?: Map<string, PolicyScope>;
  /**
   * Stop picking customers in `taken` (this policy is being saved active).
   * One already picked can still be unticked.
   */
  lockTaken?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(() => new Set(value), [value]);
  const byId = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  );
  // A customer deleted since the policy was saved has no option; skip it.
  const chips = value
    .map((id) => byId.get(id))
    .filter((c): c is SlaCustomerOption => Boolean(c));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      [c.name, c.email, c.company ?? ""].some((field) =>
        field.toLowerCase().includes(q),
      ),
    );
  }, [customers, query]);

  const toggle = (id: string) =>
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="flex flex-col gap-2">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            className="h-10 w-full justify-between border-gray-200 px-3 text-left text-sm font-normal shadow-none"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Users className="size-4 shrink-0 text-gray-500" aria-hidden />
              {chips.length === 0 ? (
                <span className="text-muted-foreground">Select customers</span>
              ) : (
                <span className="truncate text-gray-900">
                  {chips.length} customer{chips.length === 1 ? "" : "s"}{" "}
                  selected
                </span>
              )}
            </span>
            <ChevronDown className="size-4 text-gray-500" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) min-w-72 p-0"
        >
          <div className="relative border-b border-gray-100 p-2">
            <Search
              className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email or company…"
              aria-label="Search customers"
              className="h-9 border-0 pl-8 text-sm"
            />
          </div>

          <div
            role="listbox"
            aria-multiselectable
            aria-label="Customers"
            className="max-h-64 overflow-y-auto p-1"
          >
            {customers.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-500">
                This tenant has no customers yet.
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-500">
                No customers match “{query.trim()}”.
              </p>
            ) : (
              filtered.map((c) => {
                const checked = selected.has(c.id);
                const owner = taken?.get(c.id);
                const locked = Boolean(lockTaken && owner && !checked);
                return (
                  <label
                    key={c.id}
                    role="option"
                    aria-selected={checked}
                    aria-disabled={locked || undefined}
                    title={
                      locked
                        ? `Already in the active policy “${owner!.name}”`
                        : undefined
                    }
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors",
                      locked
                        ? "cursor-not-allowed opacity-60"
                        : "cursor-pointer hover:bg-gray-50",
                      checked && "bg-brand-accent/5",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={locked}
                      onCheckedChange={() => toggle(c.id)}
                      className="border-gray-300 data-checked:border-brand-accent data-checked:bg-brand-accent [&_svg]:size-3"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-gray-900">
                        {c.name}
                      </span>
                      <span className="block truncate text-xs text-gray-500">
                        {c.company ? `${c.company} · ${c.email}` : c.email}
                      </span>
                    </span>
                    {owner && (
                      <span className="max-w-32 shrink-0 truncate rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        {owner.name}
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>

          {value.length > 0 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
              {value.length} selected
              <button
                type="button"
                onClick={() => onChange([])}
                className="font-semibold text-brand-accent"
              >
                Clear
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {chips.length > 0 && (
        <ul className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
          {chips.map((c) => (
            <li
              key={c.id}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-gray-200 bg-gray-50 py-0.5 pr-1 pl-2 text-xs text-gray-700"
            >
              <span className="truncate">{c.name}</span>
              <button
                type="button"
                onClick={() => toggle(c.id)}
                aria-label={`Remove ${c.name}`}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
