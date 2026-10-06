"use client";

import React, { useState, useTransition } from "react";
import { toast } from "sonner";
import { format, isValid, parse } from "date-fns";
import { CalendarDays, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { ModalNotice } from "@/components/shared/modal-notice";
import { TimePickerPopover } from "@/features/onboarding/components/time-picker-popover";
import {
  TEAM_DIALOG_CONTENT,
  TEAM_DIALOG_FOOTER,
  TEAM_DIALOG_TITLE,
  TEAM_MODAL_BUTTON,
  TEAM_MODAL_BUTTON_PRIMARY,
  TEAM_MODAL_CONTROL,
} from "@/features/team/components/modal-buttons";
import { cn } from "@/lib/utils";
import {
  addHolidayAction,
  updateBusinessHoursScheduleAction,
  updateHolidayAction,
} from "../action/sla.actions";
import {
  BusinessHoursOption,
  HOLIDAY_DESCRIPTION_MAX,
  SlaHoliday,
  WEEK_DAYS,
} from "../types/types";

/** "Mon – Fri" for a contiguous run, otherwise "Mon, Wed, Fri". */
export function formatWorkingDays(days: string[]): string {
  const sorted = WEEK_DAYS.filter((d) => days.includes(d));
  if (sorted.length === 0) return "No working days";
  if (sorted.length === 7) return "Every day";

  const first = WEEK_DAYS.indexOf(sorted[0]);
  const contiguous = sorted.every((d, i) => WEEK_DAYS.indexOf(d) === first + i);

  return contiguous && sorted.length > 2
    ? `${sorted[0]} – ${sorted[sorted.length - 1]}`
    : sorted.join(", ");
}

/** "09:00 – 18:00". */
export function formatWorkingHours(hours: BusinessHoursOption): string {
  if (!hours.dayStart || !hours.dayEnd) return "Not set";
  return `${hours.dayStart} – ${hours.dayEnd}`;
}

/** "Jan 1, 2027". */
export function formatHolidayDate(h: SlaHoliday): string {
  const [y, m, d] = h.date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "YYYY-MM-DD" ↔ a local Date, so the picked day never shifts with the timezone. */
const ISO_DAY = "yyyy-MM-dd";

function DatePicker({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const parsed = value ? parse(value, ISO_DAY, new Date()) : undefined;
  const selected = parsed && isValid(parsed) ? parsed : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-expanded={open}
          className={cn(
            TEAM_MODAL_CONTROL,
            "w-full justify-between px-3 text-left font-normal shadow-sm",
          )}
        >
          {selected ? (
            <span className="font-medium text-slate-900">
              {format(selected, "MMM d, yyyy")}
            </span>
          ) : (
            <span className="text-muted-foreground">Pick a date</span>
          )}
          <CalendarDays className="size-4 text-slate-500" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          captionLayout="dropdown"
          // Same accent as TimePickerPopover's selected cell.
          className="[&_[data-selected-single=true]]:bg-brand-accent [&_[data-selected-single=true]]:text-brand-accent-foreground"
          onSelect={(day) => {
            if (!day) return;
            onChange(format(day, ISO_DAY));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/* ───────────────────────── Add / edit holiday ───────────────────────── */

/** Holidays are always whole days; there is no time-of-day option. */
const EMPTY_HOLIDAY = {
  name: "",
  date: "",
  repeatsYearly: false,
  description: "",
};

function toHolidayForm(holiday: SlaHoliday | null) {
  if (!holiday) return EMPTY_HOLIDAY;
  return {
    name: holiday.name,
    date: holiday.date,
    repeatsYearly: holiday.repeatsYearly,
    description: holiday.description ?? "",
  };
}

/** Adds a holiday, or edits `holiday` when one is passed. */
export function HolidayDialog({
  tenant,
  businessHoursId,
  holiday = null,
  open,
  onOpenChange,
  onSaved,
}: {
  tenant: string;
  businessHoursId: string;
  holiday?: SlaHoliday | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (next: BusinessHoursOption) => void;
}) {
  const editing = holiday !== null;
  const [form, setForm] = useState(() => toHolidayForm(holiday));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [wasOpen, setWasOpen] = useState(open);

  // Start from the holiday being edited (or a blank form) on every open.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(toHolidayForm(holiday));
      setError(null);
    }
  }

  const change = (next: boolean) => onOpenChange(next);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setError("Give the holiday a name.");
    if (!form.date) return setError("Pick a date.");

    setError(null);
    // Saving an old part-day holiday turns it into a whole day.
    const input = { ...form, allDay: true };
    startTransition(async () => {
      const result = editing
        ? await updateHolidayAction(tenant, businessHoursId, holiday.id, input)
        : await addHolidayAction(tenant, businessHoursId, input);
      if (
        !result.success ||
        !("businessHours" in result) ||
        !result.businessHours
      ) {
        setError(
          result.error ??
            (editing
              ? "Couldn't save the holiday."
              : "Couldn't add the holiday."),
        );
        return;
      }
      toast.success(editing ? "Holiday saved." : "Holiday added.");
      onSaved(result.businessHours);
      change(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className={`sm:max-w-120 ${TEAM_DIALOG_CONTENT}`}>
        <DialogHeader className="pr-6">
          <DialogTitle className={TEAM_DIALOG_TITLE}>
            {editing ? "Edit holiday" : "Add holiday"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {editing
              ? "Change a day the SLA clock does not count."
              : "Add a day the SLA clock does not count."}
          </DialogDescription>
        </DialogHeader>

        <form id="add-holiday-form" onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="holiday-name" className="text-sm font-semibold">
                Holiday name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="holiday-name"
                className={TEAM_MODAL_CONTROL}
                placeholder="e.g. New Year's Day"
                maxLength={100}
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="holiday-date" className="text-sm font-semibold">
                Date <span className="text-red-500">*</span>
              </Label>
              <DatePicker
                id="holiday-date"
                value={form.date}
                onChange={(date) => setForm((f) => ({ ...f, date }))}
              />
            </div>
          </div>

          <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox
              checked={form.repeatsYearly}
              onCheckedChange={(v) =>
                setForm((f) => ({ ...f, repeatsYearly: v === true }))
              }
              className="size-4.5 rounded data-checked:border-brand-accent data-checked:bg-brand-accent"
            />
            Repeat every year
          </label>

          <div className="space-y-1.5">
            <Label
              htmlFor="holiday-description"
              className="text-sm font-semibold"
            >
              Description{" "}
              <span className="font-normal text-muted-foreground">
                (Optional)
              </span>
            </Label>
            <div className="relative">
              <Textarea
                id="holiday-description"
                rows={3}
                maxLength={HOLIDAY_DESCRIPTION_MAX}
                placeholder="Add a short description (optional)…"
                className="resize-none pb-6"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
              <span className="pointer-events-none absolute right-3 bottom-2 text-[11px] text-muted-foreground tabular-nums">
                {form.description.length}/{HOLIDAY_DESCRIPTION_MAX}
              </span>
            </div>
          </div>

          <ModalNotice icon={Info} tone="accent">
            Holidays are excluded from SLA time calculation.
          </ModalNotice>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </form>

        <DialogFooter className={TEAM_DIALOG_FOOTER}>
          <Button
            type="button"
            variant="outline"
            className={TEAM_MODAL_BUTTON}
            onClick={() => change(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-holiday-form"
            disabled={pending}
            className={cn(TEAM_MODAL_BUTTON, TEAM_MODAL_BUTTON_PRIMARY)}
          >
            {pending
              ? editing
                ? "Saving…"
                : "Adding…"
              : editing
                ? "Save holiday"
                : "Add holiday"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── Edit business hours ───────────────────────── */

export function EditBusinessHoursDialog({
  tenant,
  businessHours,
  open,
  onOpenChange,
  onSaved,
}: {
  tenant: string;
  businessHours: BusinessHoursOption;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (next: BusinessHoursOption) => void;
}) {
  const initial = {
    workingDays: businessHours.workingDays,
    dayStart: businessHours.dayStart ?? "09:00",
    dayEnd: businessHours.dayEnd ?? "18:00",
  };
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [wasOpen, setWasOpen] = useState(open);

  // Start from the saved calendar every time the dialog opens, not from
  // whatever was left in it after a cancel.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(initial);
      setError(null);
    }
  }

  const change = (next: boolean) => onOpenChange(next);

  const toggleDay = (day: string) =>
    setForm((f) => ({
      ...f,
      workingDays: f.workingDays.includes(day)
        ? f.workingDays.filter((d) => d !== day)
        : [...f.workingDays, day],
    }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.workingDays.length === 0) {
      return setError("Pick at least one working day.");
    }
    if (form.dayEnd <= form.dayStart) {
      return setError("The day has to end after it starts.");
    }

    setError(null);
    startTransition(async () => {
      const result = await updateBusinessHoursScheduleAction(
        tenant,
        businessHours.id,
        {
          workingDays: form.workingDays,
          dayStart: form.dayStart,
          dayEnd: form.dayEnd,
          breakStart: null,
          breakEnd: null,
        },
      );
      if (
        !result.success ||
        !("businessHours" in result) ||
        !result.businessHours
      ) {
        setError(result.error ?? "Couldn't save business hours.");
        return;
      }
      toast.success("Business hours saved.");
      onSaved(result.businessHours);
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className={`sm:max-w-120 ${TEAM_DIALOG_CONTENT}`}>
        <DialogHeader className="pr-6">
          <DialogTitle className={TEAM_DIALOG_TITLE}>
            Edit business hours
          </DialogTitle>
          <DialogDescription>
            Changes apply to every SLA policy that uses {businessHours.name}.
          </DialogDescription>
        </DialogHeader>

        <form id="business-hours-form" onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Working days</Label>
            <div className="flex flex-wrap gap-2">
              {WEEK_DAYS.map((day) => {
                const on = form.workingDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDay(day)}
                    className={cn(
                      "h-9 w-12 rounded-lg border text-sm font-medium transition-colors",
                      on
                        ? "border-brand-accent bg-brand-accent/10 text-brand-accent"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="bh-start" className="text-sm font-semibold">
                Day starts
              </Label>
              <TimePickerPopover
                id="bh-start"
                className={TEAM_MODAL_CONTROL}
                value={form.dayStart}
                onChange={(dayStart) => setForm((f) => ({ ...f, dayStart }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bh-end" className="text-sm font-semibold">
                Day ends
              </Label>
              <TimePickerPopover
                id="bh-end"
                className={TEAM_MODAL_CONTROL}
                value={form.dayEnd}
                onChange={(dayEnd) => setForm((f) => ({ ...f, dayEnd }))}
              />
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </form>

        <DialogFooter className={TEAM_DIALOG_FOOTER}>
          <Button
            type="button"
            variant="outline"
            className={TEAM_MODAL_BUTTON}
            onClick={() => change(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="business-hours-form"
            disabled={pending}
            className={cn(TEAM_MODAL_BUTTON, TEAM_MODAL_BUTTON_PRIMARY)}
          >
            {pending ? "Saving…" : "Save hours"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
