"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CopyX, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TEAM_DIALOG_CONTENT,
  TEAM_DIALOG_FOOTER,
  TEAM_DIALOG_TITLE,
  TEAM_MODAL_BUTTON,
  TEAM_MODAL_BUTTON_PRIMARY,
  TEAM_MODAL_CONTROL,
} from "@/features/team/components/modal-buttons";
import { ModalNotice } from "@/components/shared/modal-notice";
import { cn } from "@/lib/utils";
import type { SavedView } from "../services/saved-views.service";
import {
  canMatchAnything,
  conditionCount,
  DEFAULT_VIEW_ROLES,
  describeFilter,
  fieldValues,
  FILTER_FIELD_LABEL,
  FILTER_FIELDS,
  filterKey,
  findSameFilterView,
  findSameNameView,
  normalizeFilter,
  repeatedRuleIndexes,
  ruleValueLabel,
  SEARCH_MAX,
  toFilterJson,
  VIEW_CONDITIONS_MAX,
  VIEW_CONDITIONS_MIN,
  VIEW_CONDITIONS_RECOMMENDED,
  VIEW_NAME_MAX,
  VIEW_ROLE_LABEL,
  VIEW_ROLES,
  viewNameKey,
  type FilterField,
  type FilterJoin,
  type FilterRule,
  type ViewFilter,
  type ViewRole,
} from "../filters";
import {
  createSavedViewAction,
  updateSavedViewAction,
} from "../actions/saved-views.actions";

interface SavedViewFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: string;
  view?: SavedView | null;
  /** The views on the page, to catch a filter that already has one. */
  views?: SavedView[];
}

const FIELD_CLASS = `${TEAM_MODAL_CONTROL} text-sm`;

/** One condition in the popup: a FilterRule plus a key for React. */
type FilterRow = FilterRule & { id: number };

/** Choices for each field; null means a free-text box. */
function optionsFor(
  field: FilterField,
): { value: string; label: string }[] | null {
  return (
    fieldValues(field)?.map((value) => ({
      value,
      label: ruleValueLabel({ field, value }),
    })) ?? null
  );
}

// Ids come from the rows themselves, not a module counter: Fast Refresh
// re-runs the module and reset the counter, handing out ids already in use.
function nextRowId(rows: FilterRow[]): number {
  return rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
}

function filterFromRows(rows: FilterRow[]): ViewFilter {
  // An empty text box is not a condition yet.
  return {
    rules: rows
      .filter((r) => r.value.trim())
      .map(({ field, value, join }) => ({ field, value: value.trim(), join })),
  };
}

/**
 * A fresh condition on `field`, on a value no other row has picked. Another
 * value of the field just above reads as OR (Pending or Open); a new field as
 * AND.
 */
function newRow(
  field: FilterField,
  rows: FilterRow[],
  join?: FilterJoin,
): FilterRow {
  const options = optionsFor(field);
  const taken = new Set(
    rows.filter((r) => r.field === field).map((r) => r.value),
  );
  const value = options
    ? (options.find((o) => !taken.has(o.value)) ?? options[0]).value
    : "";
  return {
    field,
    value,
    join: join ?? (rows.at(-1)?.field === field ? "or" : "and"),
    id: nextRowId(rows),
  };
}

/** The field a new row starts on: the last one, while it has values left. */
function nextField(rows: FilterRow[]): FilterField {
  const last = rows.at(-1)?.field ?? "status";
  const options = optionsFor(last);
  const used = rows.filter((r) => r.field === last).length;
  if (!options || used < options.length) return last;
  return FILTER_FIELDS.find((f) => f !== last) ?? "status";
}

/** The AND / OR picker between two rows. */
function JoinPicker({
  value,
  onChange,
}: {
  value: FilterJoin;
  onChange: (join: FilterJoin) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5" role="group">
      <span aria-hidden className="h-px w-3 bg-border" />
      <div
        className="inline-flex rounded-md border border-border bg-muted/40 p-0.5"
        aria-label="Join with the conditions above"
      >
        {(["and", "or"] as const).map((join) => (
          <button
            key={join}
            type="button"
            aria-pressed={value === join}
            onClick={() => onChange(join)}
            className={cn(
              "h-6 min-w-11 rounded px-2 text-[11px] font-bold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
              value === join
                ? join === "and"
                  ? "bg-brand-accent text-brand-accent-foreground shadow-sm"
                  : "bg-blue-600 text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {join.toUpperCase()}
          </button>
        ))}
      </div>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}

export default function SavedViewFormDialog({
  open,
  onOpenChange,
  tenant,
  view = null,
  views = [],
}: SavedViewFormDialogProps) {
  const isEdit = Boolean(view);
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [rows, setRows] = useState<FilterRow[]>([]);
  const [isShared, setIsShared] = useState(false);
  const [roles, setRoles] = useState<ViewRole[]>(DEFAULT_VIEW_ROLES);
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
    // A new view starts with one condition: it needs at least one.
    setRows(
      view
        ? normalizeFilter(view.filter_json).rules.map((rule, i) => ({
            ...rule,
            id: i + 1,
          }))
        : [newRow("status", [])],
    );
    setIsShared(view?.is_shared ?? false);
    setRoles(view?.visibilityRoles ?? DEFAULT_VIEW_ROLES);
    setError(undefined);
  }

  const filter = filterFromRows(rows);
  const canAddRow = rows.length < VIEW_CONDITIONS_MAX;
  // Counted on the filter, so an empty text box is not a condition.
  const conditions = conditionCount(filter);
  const conditionsOk =
    conditions >= VIEW_CONDITIONS_MIN && conditions <= VIEW_CONDITIONS_MAX;

  // The same field and value twice adds nothing; flag the later copy.
  const repeatedIndexes = new Set(
    repeatedRuleIndexes(
      rows.map((r) => ({ ...r, value: r.value.trim() })),
    ).filter((i) => rows[i].value.trim()),
  );
  const repeatedRowIds = new Set(
    rows.filter((_, i) => repeatedIndexes.has(i)).map((r) => r.id),
  );
  const takenValues = (field: FilterField, exceptId: number) =>
    new Set(
      rows
        .filter((other) => other.field === field && other.id !== exceptId)
        .map((other) => other.value),
    );

  // "Status is Pending AND Status is Open" can never match: say so.
  const impossible = conditionsOk && !canMatchAnything(filter);

  const updateRow = (id: number, next: FilterRow) =>
    setRows((current) => current.map((r) => (r.id === id ? next : r)));

  // On an edit, the name and the filter are checked only when they changed:
  // a teammate sharing a view with the same name or filter later must not
  // lock the owner out of editing the rest of theirs. The action does the same.
  const filterChanged =
    !view || filterKey(normalizeFilter(view.filter_json)) !== filterKey(filter);

  // Same tickets under another name is no new view. The action checks again.
  const duplicate =
    conditionsOk && filterChanged
      ? findSameFilterView(views, filter, view?.id)
      : undefined;

  const trimmed = name.trim();
  const nameChanged = !view || viewNameKey(view.name) !== viewNameKey(trimmed);
  // Two views with one name can't be told apart in the list.
  const sameName = nameChanged
    ? findSameNameView(views, trimmed, view?.id)
    : undefined;
  const canSubmit =
    !isPending &&
    trimmed.length > 0 &&
    trimmed.length <= VIEW_NAME_MAX &&
    conditionsOk &&
    repeatedRowIds.size === 0 &&
    !impossible &&
    !duplicate &&
    !sameName &&
    (!isShared || roles.length > 0);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (!canSubmit) return;

    setError(undefined);

    const input = {
      name: trimmed,
      filterJson: toFilterJson(filter),
      isShared,
      visibilityRoles: roles,
    };

    startTransition(async () => {
      const res = isEdit
        ? await updateSavedViewAction(tenant, view!.id, input)
        : await createSavedViewAction(tenant, input);

      if (res.success) {
        toast.success(isEdit ? "View updated" : "View created");
        onOpenChange(false);
        return;
      }

      setError(res.error || "Couldn't save that view. Try again.");
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !isPending && onOpenChange(next)}
    >
      <DialogContent
        className={`gap-4 sm:max-w-140 max-h-[90dvh] overflow-y-auto ${TEAM_DIALOG_CONTENT}`}
      >
        <DialogHeader className="-mx-5 border-b border-border px-5 pb-4 pr-11">
          <DialogTitle className={TEAM_DIALOG_TITLE}>
            {isEdit ? "Edit saved view" : "Create saved view"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Save a filter over the ticket queue to open it in one click.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="space-y-1.5">
            <Label htmlFor="view-name" className="text-sm font-semibold">
              View name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="view-name"
              placeholder="e.g. My pending tickets"
              value={name}
              maxLength={VIEW_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              aria-invalid={sameName ? true : undefined}
              aria-describedby={sameName ? "view-name-error" : undefined}
              className={FIELD_CLASS}
            />
            {sameName ? (
              <p
                id="view-name-error"
                role="alert"
                className="text-xs text-destructive"
              >
                A view called &ldquo;{sameName.name}&rdquo; already exists.
                Choose a different name.
              </p>
            ) : null}
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">Filters</legend>
            <p className="-mt-1 text-xs text-muted-foreground">
              Add {VIEW_CONDITIONS_MIN} to {VIEW_CONDITIONS_MAX} conditions (
              {VIEW_CONDITIONS_MIN}–{VIEW_CONDITIONS_RECOMMENDED} reads best).
              Read top to bottom: <strong className="font-semibold">AND</strong>{" "}
              needs both, <strong className="font-semibold">OR</strong> needs
              either, each joining a row to everything above it.
            </p>

            <ol className="space-y-1.5">
              {rows.map((r, index) => {
                const options = optionsFor(r.field);
                const invalid = repeatedRowIds.has(r.id) || undefined;
                return (
                  <li key={r.id} className="space-y-1.5">
                    {index > 0 ? (
                      <JoinPicker
                        value={r.join}
                        onChange={(join) => updateRow(r.id, { ...r, join })}
                      />
                    ) : null}

                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[8.5rem_5.5rem_minmax(0,1fr)_auto]">
                      <Select
                        value={r.field}
                        onValueChange={(field) =>
                          updateRow(r.id, {
                            ...newRow(
                              field as FilterField,
                              rows.filter((other) => other.id !== r.id),
                              r.join,
                            ),
                            id: r.id,
                          })
                        }
                      >
                        <SelectTrigger
                          aria-label={`Condition ${index + 1} field`}
                          className={`w-full ${FIELD_CLASS}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent
                          position="popper"
                          side="bottom"
                          align="start"
                          className="p-1"
                        >
                          {FILTER_FIELDS.map((field) => (
                            <SelectItem
                              key={field}
                              value={field}
                              className="p-2 cursor-pointer"
                            >
                              {FILTER_FIELD_LABEL[field]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove condition ${index + 1}`}
                        // The last condition stays: a view needs one.
                        disabled={rows.length <= VIEW_CONDITIONS_MIN}
                        onClick={() =>
                          setRows((current) =>
                            current.filter((other) => other.id !== r.id),
                          )
                        }
                        className="size-10 text-muted-foreground hover:text-destructive sm:order-last"
                      >
                        <Trash2 className="size-4" />
                      </Button>

                      {/* One operator per field, so this reads rather than picks. */}
                      <div
                        className={cn(
                          FIELD_CLASS,
                          "hidden items-center rounded-md border border-input px-3 text-muted-foreground sm:flex",
                        )}
                      >
                        {options ? "is" : "contains"}
                      </div>

                      <div className="col-span-2 sm:col-span-1">
                        {options ? (
                          <Select
                            value={r.value}
                            onValueChange={(value) =>
                              updateRow(r.id, { ...r, value })
                            }
                          >
                            <SelectTrigger
                              aria-label={`Condition ${index + 1} value`}
                              aria-invalid={invalid}
                              className={`w-full ${FIELD_CLASS}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent
                              position="popper"
                              side="bottom"
                              align="start"
                              className="p-1"
                            >
                              {options.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                  className="p-2 cursor-pointer"
                                  disabled={takenValues(r.field, r.id).has(
                                    option.value,
                                  )}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            aria-label={`Condition ${index + 1} text`}
                            aria-invalid={invalid}
                            placeholder="Subject or description"
                            value={r.value}
                            maxLength={SEARCH_MAX}
                            onChange={(e) =>
                              updateRow(r.id, { ...r, value: e.target.value })
                            }
                            className={FIELD_CLASS}
                          />
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            {canAddRow ? (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setRows((current) => [
                    ...current,
                    newRow(nextField(current), current),
                  ])
                }
                className="mt-1 h-10 gap-1.5 rounded-lg px-4 text-sm font-semibold text-brand-accent hover:text-brand-accent"
              >
                <Plus className="size-4" />
                Add filter
              </Button>
            ) : null}

            {conditions > VIEW_CONDITIONS_MAX ? (
              <p className="text-xs font-medium text-destructive">
                A view can have at most {VIEW_CONDITIONS_MAX} conditions. Remove{" "}
                {conditions - VIEW_CONDITIONS_MAX} to save it.
              </p>
            ) : conditions < VIEW_CONDITIONS_MIN ? (
              <p className="text-xs font-medium text-destructive">
                Add at least one condition.
              </p>
            ) : repeatedRowIds.size ? (
              <p className="text-xs font-medium text-destructive">
                The same condition is in the list twice. Change or remove the
                highlighted row.
              </p>
            ) : impossible ? (
              <p className="text-xs font-medium text-destructive">
                These conditions can never match a ticket: a ticket has one
                status, one priority and one assignee. Try OR instead of AND.
              </p>
            ) : null}

            {/* The whole rule in words, brackets and all. */}
            {conditions > 0 ? (
              <p className="rounded-lg bg-muted/50 px-3.5 py-2.5 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Shows:</span>{" "}
                {describeFilter(filter)}
              </p>
            ) : null}
          </fieldset>

          {duplicate ? (
            <div role="alert">
              <ModalNotice
                icon={CopyX}
                tone="amber"
                title="This filter already exists"
              >
                <p>
                  A saved view with these filter conditions already exists:{" "}
                  <span className="font-semibold text-amber-900 dark:text-amber-200">
                    &ldquo;{duplicate.name}&rdquo;
                  </span>
                  . Choose a different filter combination or open the existing
                  view.
                </p>
                <Link
                  href={`/${tenant}/tickets?view=${duplicate.id}`}
                  onClick={() => onOpenChange(false)}
                  className="mt-2 inline-block font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950 dark:text-amber-200"
                >
                  Open &ldquo;{duplicate.name}&rdquo;
                </Link>
              </ModalNotice>
            </div>
          ) : null}

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">
              Share with team
            </legend>
            <RadioGroup
              value={isShared ? "team" : "private"}
              onValueChange={(value) => setIsShared(value === "team")}
              className="gap-3"
            >
              <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                <RadioGroupItem value="private" />
                Only me (Personal view)
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <RadioGroupItem value="team" className="mt-0.5" />
                <span>
                  Share with team
                  <span className="block text-xs text-muted-foreground">
                    Visible to selected roles. Only you can edit or delete it.
                  </span>
                </span>
              </label>
            </RadioGroup>
          </fieldset>

          <fieldset className="space-y-2" disabled={!isShared}>
            <legend className="mb-2 text-sm font-semibold">
              Visible to roles
            </legend>
            <div
              className={cn(
                "flex flex-wrap gap-x-6 gap-y-2",
                !isShared && "opacity-50",
              )}
            >
              {VIEW_ROLES.map((role) => (
                <label
                  key={role}
                  className={cn(
                    "flex min-h-8 items-center gap-2 text-sm",
                    isShared ? "cursor-pointer" : "cursor-not-allowed",
                  )}
                >
                  <Checkbox
                    checked={isShared && roles.includes(role)}
                    disabled={!isShared}
                    onCheckedChange={() =>
                      setRoles((current) =>
                        VIEW_ROLES.filter((r) =>
                          r === role
                            ? !current.includes(r)
                            : current.includes(r),
                        ),
                      )
                    }
                  />
                  {VIEW_ROLE_LABEL[role]}
                </label>
              ))}
            </div>
            {isShared && roles.length === 0 ? (
              <p className="text-xs font-medium text-destructive">
                Pick at least one role to share with.
              </p>
            ) : null}
          </fieldset>

          {error ? (
            <p role="alert" className="text-xs font-semibold text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter className={TEAM_DIALOG_FOOTER}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
              className={TEAM_MODAL_BUTTON}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!canSubmit}
              className={`${TEAM_MODAL_BUTTON} ${TEAM_MODAL_BUTTON_PRIMARY}`}
            >
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {isEdit ? "Save changes" : "Create view"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
