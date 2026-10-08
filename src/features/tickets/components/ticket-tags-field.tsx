"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { setTicketTagsAction } from "@/features/tickets/actions/tickets.actions";
import { TAG_NAME_MAX, normalizeTagName } from "@/features/tickets/lib/tags";
import { TicketTag } from "@/features/tickets/types/tickets.types";

interface TicketTagsFieldProps {
  tenant: string;
  ticketId: string;
  initialTags: TicketTag[];
  /** Every tag in the tenant, for suggestions. */
  suggestions: TicketTag[];
}

export function TicketTagsField({
  tenant,
  ticketId,
  initialTags,
  suggestions,
}: TicketTagsFieldProps) {
  const [tags, setTags] = useState<TicketTag[]>(initialTags);
  const [known, setKnown] = useState<TicketTag[]>(suggestions);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [isSaving, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const query = normalizeTagName(draft);
  const have = new Set(tags.map((t) => t.name));
  const matches = known
    .filter((t) => !have.has(t.name) && (!query || t.name.includes(query)))
    .slice(0, 6);
  const canCreate =
    query.length > 0 &&
    !have.has(query) &&
    !known.some((t) => t.name === query);
  const choices = [
    ...matches.map((t) => t.name),
    ...(canCreate ? [query] : []),
  ];

  const save = (names: string[], previous: TicketTag[]) => {
    startTransition(async () => {
      const res = await setTicketTagsAction({
        tenantId: tenant,
        ticketId,
        names,
      });
      if (res.success) {
        setTags(res.tags);
        setKnown((prev) => {
          const byName = new Map(prev.map((t) => [t.name, t]));
          for (const t of res.tags) byName.set(t.name, t);
          return [...byName.values()].sort((a, b) =>
            a.name.localeCompare(b.name),
          );
        });
      } else {
        setTags(previous);
        toast.error(res.error || "Couldn't update tags.");
      }
    });
  };

  const add = (raw: string) => {
    const name = normalizeTagName(raw);
    if (!name || have.has(name)) {
      setDraft("");
      return;
    }
    const previous = tags;
    // Optimistic: the id is replaced by the saved row.
    setTags([...tags, { id: `pending-${name}`, name, color: null }]);
    setDraft("");
    setHighlight(0);
    save([...previous.map((t) => t.name), name], previous);
  };

  const remove = (name: string) => {
    const previous = tags;
    const next = tags.filter((t) => t.name !== name);
    setTags(next);
    save(
      next.map((t) => t.name),
      previous,
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && choices.length > 0) {
      e.preventDefault();
      setOpen(true);
      setHighlight((i) => (i + 1) % choices.length);
    } else if (e.key === "ArrowUp" && choices.length > 0) {
      e.preventDefault();
      setHighlight((i) => (i - 1 + choices.length) % choices.length);
    } else if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const pick = open && choices[highlight] ? choices[highlight] : draft;
      if (pick.trim()) add(pick);
    } else if (e.key === "Backspace" && !draft && tags.length > 0) {
      remove(tags[tags.length - 1].name);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="grid gap-2">
      <Label
        htmlFor="ticket-tags"
        className="flex items-center gap-1.5 font-semibold text-slate-700"
      >
        Tags
        {isSaving && (
          <Loader2 className="size-3 animate-spin text-slate-400" aria-hidden />
        )}
      </Label>

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <Badge
              key={tag.name}
              variant="secondary"
              className="gap-1 rounded-full bg-slate-100 py-0.5 pr-1 pl-2 text-[11px] font-medium text-slate-700"
            >
              {tag.name}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => remove(tag.name)}
                aria-label={`Remove tag ${tag.name}`}
                className="size-4 rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              >
                <X className="size-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          id="ticket-tags"
          value={draft}
          maxLength={TAG_NAME_MAX}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder={tags.length > 0 ? "Add another tag" : "Add a tag"}
          autoComplete="off"
          className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 placeholder:text-slate-400 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        {open && choices.length > 0 && (
          <div className="absolute top-full left-0 z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            {choices.map((name, idx) => {
              const isNew =
                canCreate && name === query && idx === choices.length - 1;
              return (
                <Button
                  key={`${isNew ? "new" : "tag"}-${name}`}
                  type="button"
                  variant="ghost"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(name);
                  }}
                  onMouseEnter={() => setHighlight(idx)}
                  className={cn(
                    "h-auto w-full justify-start gap-2 rounded-none px-3 py-2 text-left text-xs font-medium text-slate-700",
                    idx === highlight ? "bg-slate-50" : "hover:bg-slate-50",
                  )}
                >
                  {isNew ? (
                    <>
                      <Plus className="size-3.5 text-slate-400" aria-hidden />
                      Create “{name}”
                    </>
                  ) : (
                    name
                  )}
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
