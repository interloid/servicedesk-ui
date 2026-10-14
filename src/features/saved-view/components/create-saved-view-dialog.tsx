"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Loader2 } from "lucide-react";
import { SavedView } from "../services/saved-views.service";
import {
  ASSIGNEE_FILTERS,
  ASSIGNEE_LABEL,
  describeFilter,
  EMPTY_FILTER,
  normalizeFilter,
  PRIORITY_LABEL,
  STATUS_LABEL,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  toFilterJson,
  type AssigneeFilter,
  type ViewFilter,
} from "../filters";
import {
  createSavedViewAction,
  updateSavedViewAction,
} from "../actions/saved-views.actions";
import type {
  TicketPriority,
  TicketStatus,
} from "@/features/tickets/types/tickets.types";

interface SavedViewFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: string;
  view?: SavedView | null;
}

const FIELD_CLASS =
  "h-10 text-sm border-slate-200 text-slate-800 placeholder:text-slate-400 rounded-lg focus-visible:ring-1 focus-visible:ring-[#0d7a6a]";

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

export default function SavedViewFormDialog({
  open,
  onOpenChange,
  tenant,
  view = null,
}: SavedViewFormDialogProps) {
  const isEdit = Boolean(view);
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [filter, setFilter] = useState<ViewFilter>(EMPTY_FILTER);
  const [isShared, setIsShared] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Re-seed whenever the dialog opens on a different view. Without this,
  // editing showed the defaults instead of the view's own filter, and saving
  // silently wiped it.
  //
  // Adjusted during render rather than in an effect: this is derived state, and
  // React re-runs the component immediately without painting the stale values.
  // https://react.dev/learn/you-might-not-need-an-effect
  const seedKey = open ? (view?.id ?? "new") : null;
  const [seededFor, setSeededFor] = useState<string | null>(null);

  if (seedKey !== seededFor) {
    setSeededFor(seedKey);
    setName(view?.name ?? "");
    setFilter(view ? normalizeFilter(view.filter_json) : EMPTY_FILTER);
    setIsShared(view?.is_shared ?? false);
    setError(undefined);
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (!name.trim()) return;

    setError(undefined);

    const filterJson = toFilterJson(filter);

    startTransition(async () => {
      const res = isEdit
        ? await updateSavedViewAction(tenant, view!.id, {
            name: name.trim(),
            filter_json: filterJson,
            is_shared: isShared,
          })
        : await createSavedViewAction(
            tenant,
            name.trim(),
            filterJson,
            isShared,
          );

      if (res?.success) {
        onOpenChange(false);
        return;
      }

      setError(res?.error ?? "Couldn't save that view. Try again.");
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-125 p-6 font-sans rounded-2xl bg-white border-0 shadow-2xl [&>button]:hidden max-h-[90dvh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <DialogTitle className="text-lg font-extrabold text-slate-900 tracking-tight">
            {isEdit ? "Edit view" : "New view"}
          </DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-full p-1 text-slate-400 hover:text-slate-600 transition-colors focus:outline-none"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label
              htmlFor="view-name"
              className="text-xs font-semibold text-slate-900"
            >
              View name
            </Label>
            <Input
              id="view-name"
              placeholder="e.g. Waiting on engineering"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={FIELD_CLASS}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-slate-900">
              Status
            </legend>
            <p className="text-[11px] text-slate-500">
              Leave all unticked to include every status.
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-0.5">
              {TICKET_STATUSES.map((status) => (
                <label
                  key={status}
                  className="flex items-center gap-2 text-sm text-slate-800"
                >
                  <Checkbox
                    checked={filter.statuses.includes(status)}
                    onCheckedChange={() =>
                      setFilter((current) => ({
                        ...current,
                        statuses: toggle<TicketStatus>(
                          current.statuses,
                          status,
                        ),
                      }))
                    }
                  />
                  {STATUS_LABEL[status]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-slate-900">
              Priority
            </legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-0.5">
              {TICKET_PRIORITIES.map((priority) => (
                <label
                  key={priority}
                  className="flex items-center gap-2 text-sm text-slate-800"
                >
                  <Checkbox
                    checked={filter.priorities.includes(priority)}
                    onCheckedChange={() =>
                      setFilter((current) => ({
                        ...current,
                        priorities: toggle<TicketPriority>(
                          current.priorities,
                          priority,
                        ),
                      }))
                    }
                  />
                  {PRIORITY_LABEL[priority]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label
              htmlFor="view-assignee"
              className="text-xs font-semibold text-slate-900"
            >
              Assignee
            </Label>
            <Select
              value={filter.assignee}
              onValueChange={(value) =>
                setFilter((current) => ({
                  ...current,
                  assignee: value as AssigneeFilter,
                }))
              }
            >
              <SelectTrigger
                id="view-assignee"
                className="h-10 w-full text-sm border-slate-200 text-slate-800 rounded-lg focus:ring-1 focus:ring-[#0d7a6a]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border border-slate-200 rounded-lg shadow-md">
                {ASSIGNEE_FILTERS.map((option) => (
                  <SelectItem
                    key={option}
                    value={option}
                    className="text-sm text-slate-800"
                  >
                    {ASSIGNEE_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filter.assignee === "me" ? (
              <p className="text-[11px] text-slate-500">
                Resolved against whoever opens the view, so this still works
                when shared.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="view-search"
              className="text-xs font-semibold text-slate-900"
            >
              Contains text{" "}
              <span className="font-normal text-slate-400">(optional)</span>
            </Label>
            <Input
              id="view-search"
              placeholder="Matches subject or description"
              value={filter.search}
              onChange={(e) =>
                setFilter((current) => ({ ...current, search: e.target.value }))
              }
              className={FIELD_CLASS}
            />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 px-3.5 py-3">
            <div>
              <p className="text-xs font-semibold text-slate-900">
                Share with the team
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Everyone can open it. Only you can edit or delete it.
              </p>
            </div>
            <Switch
              checked={isShared}
              onCheckedChange={setIsShared}
              aria-label="Share with the team"
            />
          </div>

          {/* The filter reads back in the same words the view card uses, so
              there is no guessing what was just built. */}
          <p className="rounded-lg bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
            <span className="font-semibold text-slate-900">Shows:</span>{" "}
            {describeFilter(filter)}
          </p>

          {error ? (
            <p className="text-xs font-semibold text-red-600">{error}</p>
          ) : null}

          <div className="flex items-center justify-end space-x-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-9 px-4 text-xs font-bold text-[#0d7a6a] border-slate-200 hover:bg-slate-50 rounded-lg shadow-none"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !name.trim()}
              className="h-9 px-4 text-xs font-bold bg-[#0d7a6a] hover:bg-[#095b4f] text-white rounded-lg shadow-none"
            >
              {isPending && (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              )}
              {isEdit ? "Save changes" : "Save view"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
