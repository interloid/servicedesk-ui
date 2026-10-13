"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  const [isSaving, startTransition] = useTransition();

  // The tag lists the server last confirmed, and the latest list waiting to
  // be saved. Saves run one at a time, each sending the newest list, so two
  // quick changes can't land out of order and drop one.
  const confirmedRef = useRef<TicketTag[]>(initialTags);
  const queuedRef = useRef<string[] | null>(null);
  const runningRef = useRef(false);

  // A fresh server render (router.refresh, a teammate's change) re-syncs the
  // chips, unless a save of ours is still in flight. Compared by content: the
  // parent can hand over a new array with the same tags on any render.
  const tagsKey = initialTags.map((t) => `${t.id}:${t.name}`).join("|");
  const [seenTagsKey, setSeenTagsKey] = useState(tagsKey);
  if (tagsKey !== seenTagsKey && !isSaving) {
    setSeenTagsKey(tagsKey);
    setTags(initialTags);
  }
  useEffect(() => {
    if (!runningRef.current) confirmedRef.current = initialTags;
    // initialTags is read by content (tagsKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagsKey]);
  const suggestionsKey = suggestions.map((t) => t.name).join("|");
  const [seenSuggestionsKey, setSeenSuggestionsKey] = useState(suggestionsKey);
  if (suggestionsKey !== seenSuggestionsKey) {
    setSeenSuggestionsKey(suggestionsKey);
    setKnown((prev) => mergeTags(prev, suggestions));
  }

  const query = normalizeTagName(draft);
  const have = new Set(tags.map((t) => t.name));
  // Every tenant tag, applied ones first (ticked, so they can be unticked
  // here too); the list scrolls past a handful.
  // An exact match leads, so Enter (cmdk highlights the first item) picks
  // the tag typed, not a longer one containing it.
  const matches = known.filter((t) => !query || t.name.includes(query));
  const ordered = [
    ...matches.filter((t) => t.name === query),
    ...matches.filter((t) => t.name !== query && have.has(t.name)),
    ...matches.filter((t) => t.name !== query && !have.has(t.name)),
  ];
  const canCreate =
    query.length > 0 &&
    !have.has(query) &&
    !known.some((t) => t.name === query);

  const save = (names: string[]) => {
    queuedRef.current = names;
    if (runningRef.current) return;
    runningRef.current = true;
    startTransition(async () => {
      const fail = (message: string) => {
        // Changes queued on top of the failed one are dropped with it.
        queuedRef.current = null;
        setTags(confirmedRef.current);
        toast.error(message);
      };
      try {
        while (queuedRef.current) {
          const sending = queuedRef.current;
          queuedRef.current = null;
          const res = await setTicketTagsAction({
            tenantSlug: tenant,
            ticketId,
            names: sending,
          });
          if (!res.success) {
            fail(res.error || "Couldn't update tags.");
            break;
          }
          confirmedRef.current = res.tags;
          setKnown((prev) => mergeTags(prev, res.tags));
          // A newer list is still to be sent: keep showing it.
          if (!queuedRef.current) setTags(res.tags);
        }
      } catch {
        fail("Couldn't update tags.");
      } finally {
        runningRef.current = false;
      }
    });
  };

  const add = (raw: string) => {
    const name = normalizeTagName(raw);
    if (!name || have.has(name)) {
      setDraft("");
      return;
    }
    // Optimistic: the id is replaced by the saved row.
    const next = [...tags, { id: `pending-${name}`, name, color: null }];
    setTags(next);
    setDraft("");
    save(next.map((t) => t.name));
  };

  const remove = (name: string) => {
    const next = tags.filter((t) => t.name !== name);
    setTags(next);
    save(next.map((t) => t.name));
  };

  const toggle = (name: string) => (have.has(name) ? remove(name) : add(name));

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

      {/* Input-styled box holding the button and the chips; past ~3 rows
          of tags it scrolls instead of growing. */}
      <div className="flex max-h-28 min-h-10 flex-wrap content-start items-center gap-1.5 overflow-y-auto rounded-md border border-slate-200 bg-white p-1.5">
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setDraft("");
          }}
        >
          <PopoverTrigger asChild>
            <Button
              id="ticket-tags"
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={open}
              className="h-7 gap-1 rounded-full px-2.5 text-[11px] font-semibold text-slate-700"
            >
              <Plus className="size-3" aria-hidden />
              Add tag
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            {/* Filtering is ours (tag names are normalised), not cmdk's. */}
            <Command shouldFilter={false}>
              <CommandInput
                value={draft}
                maxLength={TAG_NAME_MAX}
                onValueChange={setDraft}
                placeholder="Search or create tag…"
                className="h-10 text-xs"
              />
              <CommandList className="max-h-60">
                <CommandEmpty className="px-3 py-5 text-center text-xs text-slate-500">
                  {/* Typed text always lists a match or "Create", so this
                      shows only for an empty search with no tags yet. */}
                  No tags yet. Type to create one.
                </CommandEmpty>
                {/* First when there's no exact match, so typing "bug" with
                    "bugfix" listed and pressing Enter creates "bug". */}
                {canCreate && (
                  <CommandGroup>
                    <CommandItem
                      value={`create:${query}`}
                      onSelect={() => add(query)}
                      className="gap-1.5 text-xs font-semibold text-brand-accent"
                    >
                      <Plus className="size-3 shrink-0" aria-hidden />
                      <span className="truncate">Create “{query}”</span>
                    </CommandItem>
                  </CommandGroup>
                )}
                {ordered.length > 0 && (
                  <CommandGroup>
                    {ordered.map((tag) => {
                      const selected = have.has(tag.name);
                      return (
                        <CommandItem
                          key={tag.name}
                          value={tag.name}
                          onSelect={() => toggle(tag.name)}
                          className="justify-between text-xs font-medium text-slate-700"
                        >
                          <span className="truncate">{tag.name}</span>
                          {selected && (
                            <Check
                              className="size-3.5 text-brand-accent"
                              aria-hidden
                            />
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {tags.map((tag) => (
          <Badge
            key={tag.name}
            variant="secondary"
            className="max-w-40 gap-1 rounded-full bg-slate-100 py-0.5 pr-1 pl-2 text-[11px] font-medium text-slate-700"
          >
            <span className="truncate">{tag.name}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => remove(tag.name)}
              aria-label={`Remove tag ${tag.name}`}
              className="size-4 shrink-0 rounded-full border-0 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            >
              <X className="size-3" />
            </Button>
          </Badge>
        ))}
      </div>
    </div>
  );
}

/** `prev` with `incoming` added or updated by name, sorted by name. */
function mergeTags(prev: TicketTag[], incoming: TicketTag[]): TicketTag[] {
  const byName = new Map(prev.map((t) => [t.name, t]));
  for (const t of incoming) byName.set(t.name, t);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
