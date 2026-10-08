"use client";

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  CircleIcon,
  Clock,
  Lock,
  Pencil,
  Plus,
  Trash2,
  TreePalm,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  BusinessHoursOption,
  ESCALATION_ROLES,
  POLICY_STATUS_LABELS,
  PolicyStatus,
  PriorityScope,
  SLA_DESCRIPTION_MAX,
  SlaAppliesTo,
  SlaCustomerOption,
  SlaHoliday,
  SlaPolicyEditorValue,
  TimeCalculation,
  describePriorityOrderViolation,
  findPriorityOrderViolation,
  type EscalationRole,
} from "../types/types";
import {
  DurationInput,
  DurationUnit as Unit,
  UNIT_MINS,
  toDurationInput,
  toMinutes,
} from "../duration";
import {
  createSlaPolicyAction,
  removeHolidayAction,
  updateSlaPolicyAction,
} from "../action/sla.actions";
import { BADGE, BADGE_TONES, StatusBadge } from "./status-badge";

import { CustomerPicker } from "./customer-picker";
import {
  PolicyScope,
  customersInActivePolicies,
  describeScopeConflict,
  findScopeConflict,
} from "../scope-rules";
import {
  EditBusinessHoursDialog,
  HolidayDialog,
} from "./business-hours-dialogs";
import {
  formatHolidayDate,
  formatWorkingDays,
  formatWorkingHours,
} from "../format";

interface SlaEditorProps {
  tenant: string;
  mode: "new" | "edit";
  initial: SlaPolicyEditorValue;
  businessHours: BusinessHoursOption[];
  /** The tenant's customers, for "Selected customers". */
  customers: SlaCustomerOption[];
  /** Every other policy, for the one-active-policy rules. */
  otherPolicies: PolicyScope[];
  /**
   * For roles that may only look (agents): every control is disabled and
   * there is no Save. The server refuses their writes either way.
   */
  readOnly: boolean;
}

const CONTROL = "h-10 border-gray-200 text-sm focus:border-0";
/** shadcn Card at the page's 20px padding, with a border instead of its ring. */
const CARD =
  "gap-4 border border-gray-200/80 bg-white shadow-xs ring-0 [--card-spacing:--spacing(5)]";
/** A table set inside a card: its own rounded border, header tinted. */
const INSET_TABLE = "overflow-hidden rounded-xl border border-gray-200";
/**
 * The holidays table is always three rows tall (40px header + 3 × 52px rows +
 * borders = 199px), locked or not; more holidays scroll inside it under a
 * sticky header. Targets the shadcn Table's own scroll container.
 */
const HOLIDAY_TABLE_SCROLL =
  "[&_[data-slot=table-container]]:h-[199px] [&_[data-slot=table-container]]:overflow-y-auto";
const TABLE_HEAD_ROW = "border-gray-200 bg-gray-50/70 hover:bg-gray-50/70";
const TH = "px-3 text-xs font-semibold text-gray-600";
/** Same as the billing page's in-card buttons (e.g. "Refresh"). */
const CARD_BUTTON =
  "h-10 gap-2 rounded-lg px-4 text-sm font-semibold duration-200 ease-out motion-safe:active:scale-[0.98]";

/* ── Number + unit durations ─────────────────────────────────────────── */

/** Amounts are whole counts, so anything typed or pasted that isn't a digit is dropped. */
function toDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

function unitLabel(unit: Unit, amount: string): string {
  const singular = amount.trim() === "1";
  if (unit === "minutes") return singular ? "Minute" : "Minutes";
  if (unit === "hours") return singular ? "Hour" : "Hours";
  return singular ? "Day" : "Days";
}

type TargetInputs = Record<
  PriorityScope,
  { firstResponse: DurationInput; resolution: DurationInput }
>;

const PRIORITY_STYLES: Record<PriorityScope, { dot: string; label: string }> = {
  urgent: { dot: "bg-red-500", label: "Urgent" },
  high: { dot: "bg-orange-500", label: "High" },
  normal: { dot: "bg-blue-500", label: "Normal" },
  low: { dot: "bg-emerald-600", label: "Low" },
};

type Errors = {
  name?: string;
  description?: string;
  notifyBefore?: string;
  businessHours?: string;
  appliesTo?: string;
  targets: Partial<Record<PriorityScope, string>>;
};

export default function SlaEditor({
  tenant,
  mode,
  initial,
  businessHours: initialBusinessHours,
  customers,
  otherPolicies,
  readOnly,
}: SlaEditorProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<SlaPolicyEditorValue>(initial);
  const [calendars, setCalendars] = useState(initialBusinessHours);
  const [errors, setErrors] = useState<Errors>({ targets: {} });
  const [formError, setFormError] = useState<string | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  // null = closed; `holiday: null` = adding a new one.
  const [holidayDialog, setHolidayDialog] = useState<{
    holiday: SlaHoliday | null;
  } | null>(null);
  const [removingHolidayId, setRemovingHolidayId] = useState<string | null>(
    null,
  );
  // The holiday the delete confirmation is asking about; null = no dialog.
  const [holidayToDelete, setHolidayToDelete] = useState<SlaHoliday | null>(
    null,
  );

  const [targetInputs, setTargetInputs] = useState<TargetInputs>(
    () =>
      Object.fromEntries(
        initial.targets.map((t) => [
          t.priority,
          {
            firstResponse: toDurationInput(t.firstResponseMins),
            resolution: toDurationInput(t.resolutionMins),
          },
        ]),
      ) as TargetInputs,
  );

  // The warning lead time only goes up to a day, so no "days" unit here.
  const [notifyLead, setNotifyLead] = useState<DurationInput>(() =>
    initial.notifyBeforeMins % 60 === 0
      ? { amount: String(initial.notifyBeforeMins / 60), unit: "hours" }
      : { amount: String(initial.notifyBeforeMins), unit: "minutes" },
  );

  const calendar =
    calendars.find((c) => c.id === draft.businessHoursId) ?? null;

  // Live check of the one-active rules (scope-rules.ts); the server enforces
  // the same thing on save.
  const takenCustomers = useMemo(
    () => customersInActivePolicies(otherPolicies),
    [otherPolicies],
  );
  const scopeConflict = findScopeConflict(
    {
      id: initial.id,
      isDefault: draft.isDefault,
      status: draft.status,
      appliesTo: draft.appliesTo,
      customerIds:
        draft.appliesTo === "Selected customers" ? draft.customerIds : [],
    },
    otherPolicies,
  );
  const scopeConflictMessage = scopeConflict
    ? describeScopeConflict(
        scopeConflict,
        (id) => customers.find((c) => c.id === id)?.name,
      )
    : null;

  const currentDefault = otherPolicies.find((p) => p.isDefault) ?? null;

  // The default SLA is the fallback: always active, for all customers.
  const setIsDefault = (checked: boolean) =>
    setDraft((p) => ({
      ...p,
      isDefault: checked,
      ...(checked
        ? { status: "active" as const, appliesTo: "All customers" as const }
        : {}),
    }));

  // The calendar cards only unlock for business-hours policies.
  const activeCalendar = draft.timeCalculation === "business" ? calendar : null;

  const replaceCalendar = (next: BusinessHoursOption) =>
    setCalendars((prev) => prev.map((c) => (c.id === next.id ? next : c)));

  const removeHoliday = async (holiday: SlaHoliday) => {
    if (!activeCalendar) return;
    const calendarId = activeCalendar.id;
    setRemovingHolidayId(holiday.id);
    const result = await removeHolidayAction(tenant, calendarId, holiday.id);
    setRemovingHolidayId(null);
    if (!result.success) {
      toast.error(result.error ?? "Couldn't remove the holiday.");
      return;
    }
    toast.success(`Removed ${holiday.name}.`);
    replaceCalendar(result.businessHours);
  };

  const setTimeCalculation = (value: TimeCalculation) =>
    setDraft((prev) => ({
      ...prev,
      timeCalculation: value,
      // Keep whichever calendar was chosen so flipping back restores it; the
      // payload drops it for 24/7.
      businessHoursId:
        value === "business"
          ? (prev.businessHoursId ?? calendars[0]?.id ?? null)
          : prev.businessHoursId,
    }));

  const setTargetInput = (
    scope: PriorityScope,
    field: "firstResponse" | "resolution",
    patch: Partial<DurationInput>,
  ) =>
    setTargetInputs((prev) => ({
      ...prev,
      [scope]: { ...prev[scope], [field]: { ...prev[scope][field], ...patch } },
    }));

  /** Builds the payload, or records errors and returns null. */
  const collect = () => {
    const next: Errors = { targets: {} };
    const business = draft.timeCalculation === "business";

    if (draft.name.trim().length === 0) {
      next.name = "Please provide a name for this policy.";
    }
    if (draft.description.length > SLA_DESCRIPTION_MAX) {
      next.description = `Keep it under ${SLA_DESCRIPTION_MAX} characters.`;
    }
    if (
      draft.appliesTo === "Selected customers" &&
      draft.customerIds.length === 0
    ) {
      next.appliesTo = "Pick at least one customer, or apply to all customers.";
    }
    if (business && !calendar) {
      next.businessHours = "Pick a business hours calendar, or use 24/7.";
    }

    const notifyMins = toMinutes(notifyLead);
    if (draft.notifyBeforeBreach && (!notifyMins || notifyMins > 1440)) {
      // Matches chk_sla_notify_before_mins.
      next.notifyBefore = "Use a whole number, up to 24 hours.";
    }

    const targets = draft.targets.map((t) => {
      const input = targetInputs[t.priority];
      const first = toMinutes(input.firstResponse);
      const resolution = toMinutes(input.resolution);

      if (!first || !resolution) {
        next.targets[t.priority] = "Enter whole numbers greater than zero.";
      } else if (resolution < first) {
        // chk_sla_resolution_ge_first_response would reject it anyway.
        next.targets[t.priority] =
          "Resolution must be at least the first response time.";
      }

      return {
        priority: t.priority,
        firstResponseMins: first ?? 0,
        firstResponseBusiness: business,
        resolutionMins: resolution ?? 0,
        resolutionBusiness: business,
      };
    });

    // The ladder: urgent is the tightest, low the loosest, so a lower priority
    // may never answer or resolve faster than a higher one.
    const violation = findPriorityOrderViolation(targets);
    if (violation && !next.targets[violation.scope]) {
      next.targets[violation.scope] = describePriorityOrderViolation(violation);
    }

    setErrors(next);
    const ok =
      !next.name &&
      !next.description &&
      !next.businessHours &&
      !next.appliesTo &&
      !next.notifyBefore &&
      Object.keys(next.targets).length === 0;

    if (!ok) return null;

    return {
      name: draft.name.trim(),
      description: draft.description.trim(),
      applies_to: draft.appliesTo,
      is_default: draft.isDefault,
      customer_ids:
        draft.appliesTo === "Selected customers" ? draft.customerIds : [],
      business_hours_id: business ? draft.businessHoursId : null,
      status: draft.status,
      notify_before_breach: draft.notifyBeforeBreach,
      notify_before_mins: notifyMins ?? draft.notifyBeforeMins,
      escalate_on_breach: draft.escalateOnBreach,
      escalate_to_role: draft.escalateToRole,
      targets,
    };
  };

  const save = () => {
    const payload = collect();
    if (!payload) {
      setFormError("Check the highlighted fields.");
      return;
    }
    if (scopeConflictMessage) {
      setFormError(scopeConflictMessage);
      return;
    }
    if (mode === "edit" && !initial.id) {
      setFormError("Policy ID is missing. Please go back and try again.");
      return;
    }

    setFormError(null);
    startTransition(async () => {
      const result =
        mode === "new"
          ? await createSlaPolicyAction(tenant, payload)
          : await updateSlaPolicyAction(tenant, initial.id!, payload);

      if (!result.success) {
        setFormError(result.error ?? "Something went wrong.");
        toast.error(result.error ?? "Something went wrong.");
        return;
      }

      toast.success(mode === "new" ? "Policy created." : "Policy saved.");
      router.push(`/${tenant}/sla`);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <Link
            href={`/${tenant}/sla`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-accent transition-colors hover:text-brand-accent/80"
          >
            <ArrowLeft className="size-4" aria-hidden />
            SLA policies
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl capitalize font-bold tracking-tight text-gray-900">
              {mode === "new"
                ? "Create SLA policy"
                : initial.name || "Edit SLA policy"}
            </h1>
            {mode === "edit" && <StatusBadge status={initial.status} />}
          </div>
          <p className="text-sm text-gray-500">
            Define how quickly your team should respond to and resolve customer
            tickets.
          </p>
        </div>

        <div
          className={cn(
            "flex w-full flex-wrap items-center gap-3 *:flex-1 sm:w-auto sm:*:flex-none",
            readOnly && "hidden",
          )}
        >
          <Button
            onClick={save}
            disabled={pending}
            className="h-10 gap-2 rounded-lg bg-brand-accent px-4 text-sm font-semibold text-brand-accent-foreground shadow-none hover:bg-brand-accent/90"
          >
            {mode === "edit" && <Plus className="size-4" aria-hidden />}
            {pending
              ? mode === "new"
                ? "Creating…"
                : "Saving…"
              : mode === "new"
                ? "Create policy"
                : "Save changes"}
          </Button>
          {mode === "new" && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-10 gap-2 rounded-lg bg-white px-4 text-sm font-semibold shadow-none"
            >
              <Link href={`/${tenant}/sla`}>Cancel</Link>
            </Button>
          )}
        </div>
      </div>

      {readOnly && (
        <p className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          You can view this policy. Only tenant admins and managers can change
          it.
        </p>
      )}

      {formError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {formError}
        </p>
      )}

      <fieldset disabled={readOnly} className="min-w-0">
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="flex flex-col gap-5">
            <Section step={1} title="Basic Information">
              <div className="flex flex-col gap-3">
                <Field label="Policy name" required error={errors.name}>
                  <Input
                    className={CONTROL}
                    value={draft.name}
                    maxLength={120}
                    aria-invalid={Boolean(errors.name) || undefined}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, name: e.target.value }))
                    }
                    placeholder="e.g. Priority support"
                  />
                </Field>

                <Field
                  label="Status"
                  hint={
                    draft.isDefault
                      ? "The default SLA is always active."
                      : undefined
                  }
                >
                  <Select
                    value={draft.status}
                    disabled={draft.isDefault}
                    onValueChange={(v) =>
                      setDraft((p) => ({ ...p, status: v as PolicyStatus }))
                    }
                  >
                    <SelectTrigger className="w-full min-h-11 h-10 border-gray-200 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      side="bottom"
                      align="start"
                      position="popper"
                      className="p-1"
                    >
                      {(
                        Object.keys(POLICY_STATUS_LABELS) as PolicyStatus[]
                      ).map((s) => (
                        <SelectItem
                          key={s}
                          value={s}
                          className="min-h-11 cursor-pointer"
                        >
                          {POLICY_STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Description" error={errors.description}>
                  <Textarea
                    maxLength={SLA_DESCRIPTION_MAX}
                    // Full height from the start instead of growing with the text.
                    className="field-sizing-fixed h-21 resize-none overflow-y-auto border-gray-200 text-sm focus-within:border-0"
                    value={draft.description}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, description: e.target.value }))
                    }
                    placeholder="Describe when this policy should be used…"
                  />
                </Field>

                <Field
                  label="Applies to"
                  hint="Choose which customers' tickets this policy covers."
                  error={errors.appliesTo}
                >
                  <RadioGroup
                    value={draft.appliesTo}
                    onValueChange={(v) =>
                      setDraft((p) => ({ ...p, appliesTo: v as SlaAppliesTo }))
                    }
                    aria-label="Applies to"
                    className="grid-cols-1 gap-3 sm:grid-cols-2"
                  >
                    <AppliesToOption
                      value="All customers"
                      selected={draft.appliesTo === "All customers"}
                      title="All tickets"
                      body="Every customer's tickets use this policy."
                    />
                    <AppliesToOption
                      value="Selected customers"
                      selected={draft.appliesTo === "Selected customers"}
                      disabled={draft.isDefault}
                      title="Selected customers"
                      body={
                        draft.isDefault
                          ? "Not for the default SLA — it covers everyone."
                          : "Only tickets from the customers you pick."
                      }
                    />
                  </RadioGroup>
                  {draft.appliesTo === "Selected customers" && (
                    <CustomerPicker
                      customers={customers}
                      value={draft.customerIds}
                      invalid={Boolean(errors.appliesTo)}
                      taken={takenCustomers}
                      onChange={(customerIds) =>
                        setDraft((p) => ({ ...p, customerIds }))
                      }
                    />
                  )}
                  {scopeConflictMessage && (
                    <p
                      role="status"
                      className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                    >
                      <TriangleAlert
                        className="mt-px size-3.5 shrink-0"
                        aria-hidden
                      />
                      {scopeConflictMessage}
                    </p>
                  )}
                </Field>

                <DefaultSlaCheckbox
                  checked={draft.isDefault}
                  isCurrentDefault={initial.isDefault}
                  currentDefaultName={currentDefault?.name ?? null}
                  onCheckedChange={setIsDefault}
                />
              </div>
            </Section>

            <Section
              step={2}
              title="SLA Targets by Priority"
              hint="Set the first response and resolution time for each ticket priority. Times must get longer as priority drops: urgent is the tightest, low the loosest."
            >
              <div className={INSET_TABLE}>
                <Table className="min-w-160 md:min-w-0">
                  <TableHeader>
                    <TableRow className={TABLE_HEAD_ROW}>
                      <TableHead className={TH}>Priority</TableHead>
                      <TableHead className={TH}>First Response Time</TableHead>
                      <TableHead className={TH}>Resolution Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draft.targets.map((target) => {
                      const input = targetInputs[target.priority];
                      const style = PRIORITY_STYLES[target.priority];
                      const error = errors.targets[target.priority];

                      return (
                        <React.Fragment key={target.priority}>
                          <TableRow
                            className={cn(
                              "border-gray-100 hover:bg-transparent",
                              error && "border-b-0",
                            )}
                          >
                            <TableCell className="px-3 py-1.5 font-medium text-gray-900">
                              <span className="inline-flex items-center gap-2">
                                <span
                                  className={cn(
                                    "size-2 rounded-full",
                                    style.dot,
                                  )}
                                />
                                {style.label}
                              </span>
                            </TableCell>
                            <TableCell className="px-3 py-1.5">
                              <DurationInputs
                                label={`${style.label} first response`}
                                value={input.firstResponse}
                                invalid={Boolean(error)}
                                onChange={(patch) =>
                                  setTargetInput(
                                    target.priority,
                                    "firstResponse",
                                    patch,
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell className="px-3 py-1.5">
                              <DurationInputs
                                label={`${style.label} resolution`}
                                value={input.resolution}
                                invalid={Boolean(error)}
                                onChange={(patch) =>
                                  setTargetInput(
                                    target.priority,
                                    "resolution",
                                    patch,
                                  )
                                }
                              />
                            </TableCell>
                          </TableRow>
                          {error && (
                            <TableRow className="border-gray-100 hover:bg-transparent">
                              <TableCell
                                colSpan={3}
                                className="px-3 pt-0 pb-1.5 text-xs whitespace-normal text-red-600"
                              >
                                {error}
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </Section>
          </div>

          <div className="flex flex-col gap-5">
            <Section
              step={3}
              title="Time Calculation"
              hint="Choose how SLA time should be calculated."
            >
              <div
                role="radiogroup"
                aria-label="Time calculation"
                className="grid grid-cols-1 gap-3 md:grid-cols-2"
              >
                <ChoiceCard
                  selected={draft.timeCalculation === "24/7"}
                  onSelect={() => setTimeCalculation("24/7")}
                  icon={Clock}
                  title="24/7"
                  body="SLA is calculated 24/7."
                />
                <ChoiceCard
                  selected={draft.timeCalculation === "business"}
                  onSelect={() => setTimeCalculation("business")}
                  disabled={calendars.length === 0}
                  icon={CalendarDays}
                  title="Business Hours"
                  body={
                    calendars.length === 0
                      ? "No calendar exists."
                      : "SLA is calculated only during working days/hours."
                  }
                />
              </div>

              {errors.businessHours && (
                <p className="mt-2 text-xs text-red-600">
                  {errors.businessHours}
                </p>
              )}
            </Section>

            <IconCard
              icon={CalendarDays}
              title="Business Hours"
              hint="Define your team's working hours for SLA calculation."
              locked={!activeCalendar}
              action={
                <Button
                  type="button"
                  variant="outline"
                  disabled={!activeCalendar}
                  onClick={() => setHoursOpen(true)}
                  className={`${CARD_BUTTON} ${
                    !activeCalendar
                      ? "cursor-not-allowed opacity-50 text-gray-400"
                      : ""
                  }`}
                >
                  Edit business hours
                </Button>
              }
            >
              {activeCalendar ? (
                <>
                  {calendars.length > 1 && (
                    <Select
                      value={activeCalendar.id}
                      onValueChange={(v) =>
                        setDraft((p) => ({ ...p, businessHoursId: v }))
                      }
                    >
                      <SelectTrigger
                        className="mb-3 h-9 w-full border-gray-200 text-sm sm:w-64"
                        aria-label="Business hours calendar"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {calendars.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <BusinessHoursSummary
                    workingDays={formatWorkingDays(activeCalendar.workingDays)}
                    workingHours={formatWorkingHours(activeCalendar)}
                    holidayCount={activeCalendar.holidays.length}
                    onManageHolidays={() => setHolidayDialog({ holiday: null })}
                  />
                </>
              ) : (
                <LockedPreview
                  title="Business hours are disabled"
                  body="Business hours are not used when 24/7 calculation is selected."
                ></LockedPreview>
              )}
            </IconCard>

            <IconCard
              icon={CalendarDays}
              title="Holidays"
              hint="Days excluded from SLA time calculation."
              locked={!activeCalendar}
              action={
                <Button
                  type="button"
                  variant="outline"
                  disabled={!activeCalendar}
                  onClick={() => setHolidayDialog({ holiday: null })}
                  className={`${CARD_BUTTON} ${
                    !activeCalendar
                      ? "cursor-not-allowed opacity-50 text-gray-400"
                      : ""
                  }`}
                >
                  <Plus className="size-4" aria-hidden />
                  Add holiday
                </Button>
              }
            >
              {activeCalendar ? (
                <HolidaysTable
                  holidays={activeCalendar.holidays}
                  removingId={removingHolidayId}
                  onEdit={(holiday) => setHolidayDialog({ holiday })}
                  onRemove={(holiday) => setHolidayToDelete(holiday)}
                />
              ) : (
                <LockedPreview
                  title="Holidays are disabled"
                  body="Holidays are not used when 24/7 calculation is selected."
                ></LockedPreview>
              )}
            </IconCard>

            <IconCard icon={Bell} title="Notifications" optional solid>
              <div className="grid grid-cols-1 items-center gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
                <div className="flex items-center gap-3">
                  <Switch
                    id="notify-breach"
                    checked={draft.notifyBeforeBreach}
                    onCheckedChange={(v) =>
                      setDraft((p) => ({ ...p, notifyBeforeBreach: v }))
                    }
                    className="data-[state=checked]:bg-brand-accent"
                  />
                  <Label
                    htmlFor="notify-breach"
                    className="cursor-pointer text-sm font-semibold text-gray-800"
                  >
                    Notify assignee before breach
                  </Label>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Input
                      inputMode="numeric"
                      className="h-9 w-16 border-gray-200 text-sm"
                      value={notifyLead.amount}
                      disabled={!draft.notifyBeforeBreach}
                      aria-label="How long before the target to warn the assignee"
                      aria-invalid={Boolean(errors.notifyBefore) || undefined}
                      onChange={(e) =>
                        setNotifyLead((n) => ({
                          ...n,
                          amount: toDigits(e.target.value),
                        }))
                      }
                    />
                    <Select
                      value={notifyLead.unit}
                      disabled={!draft.notifyBeforeBreach}
                      onValueChange={(v) =>
                        setNotifyLead((n) => ({ ...n, unit: v as Unit }))
                      }
                    >
                      <SelectTrigger
                        className="min-h-9 w-28 border-gray-200 text-sm"
                        aria-label="Lead time unit"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent
                        side="bottom"
                        align="start"
                        position="popper"
                        className="p-1"
                      >
                        {(["minutes", "hours"] as Unit[]).map((u) => (
                          <SelectItem
                            key={u}
                            value={u}
                            className="p-2 cursor-pointer"
                          >
                            {unitLabel(u, notifyLead.amount)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-500">
                      Before the SLA deadline
                    </p>
                  </div>
                  {errors.notifyBefore && (
                    <p className="text-xs text-red-600">
                      {errors.notifyBefore}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <Switch
                    id="escalate-breach"
                    checked={draft.escalateOnBreach}
                    onCheckedChange={(v) =>
                      setDraft((p) => ({
                        ...p,
                        escalateOnBreach: v,
                      }))
                    }
                    className="data-[state=checked]:bg-brand-accent"
                  />

                  <Label
                    htmlFor="escalate-breach"
                    className="cursor-pointer text-sm font-semibold text-gray-800"
                  >
                    Escalate on breach
                  </Label>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Select
                    value={draft.escalateToRole}
                    onValueChange={(v) =>
                      setDraft((p) => ({
                        ...p,
                        escalateToRole: v as EscalationRole,
                      }))
                    }
                    disabled={!draft.escalateOnBreach}
                  >
                    <SelectTrigger
                      className="min-h-9 w-44 border-gray-200 text-sm"
                      aria-label="Escalate to"
                    >
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent
                      side="bottom"
                      align="start"
                      position="popper"
                      className="p-1"
                    >
                      {ESCALATION_ROLES.map((role) => (
                        <SelectItem
                          key={role.value}
                          value={role.value}
                          className="min-h-9 cursor-pointer p-2"
                        >
                          {role.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <p className="text-xs text-gray-500">
                    Automatically escalate the ticket if SLA is breached.
                  </p>
                </div>
              </div>
            </IconCard>
          </div>
        </div>
      </fieldset>

      {activeCalendar && !readOnly && (
        <>
          <HolidayDialog
            tenant={tenant}
            businessHoursId={activeCalendar.id}
            holiday={holidayDialog?.holiday ?? null}
            holidays={activeCalendar.holidays}
            open={holidayDialog !== null}
            onOpenChange={(open) => {
              if (!open) setHolidayDialog(null);
            }}
            onSaved={replaceCalendar}
          />
          <EditBusinessHoursDialog
            tenant={tenant}
            businessHours={activeCalendar}
            open={hoursOpen}
            onOpenChange={setHoursOpen}
            onSaved={replaceCalendar}
          />
          <AlertDialog
            open={holidayToDelete !== null}
            onOpenChange={(open) => {
              if (!open) setHolidayToDelete(null);
            }}
          >
            <AlertDialogContent
              className="
                w-[calc(100%-2rem)]
                data-[size=default]:max-w-110
                rounded-2xl
                border
                border-border
                bg-background
                p-0
                shadow-xl
                overflow-hidden
              "
            >
              <AlertDialogHeader className="block px-6 pt-5 pb-4 text-left">
                <div className="flex items-center justify-between gap-4">
                  <AlertDialogTitle className="text-xl font-bold text-foreground">
                    Remove holiday
                  </AlertDialogTitle>
                  <AlertDialogCancel
                    disabled={removingHolidayId !== null}
                    className="
                      absolute
                      right-4
                      top-4
                      z-20
                      flex
                      size-8
                      items-center
                      justify-center
                      rounded-md
                      border-0
                      bg-transparent
                      p-0
                      text-muted-foreground
                      shadow-none
                      hover:bg-transparent
                      hover:text-foreground
                      focus:outline-none
                      focus:ring-2
                      focus:ring-current/20
                      disabled:pointer-events-none
                    "
                    aria-label="Close"
                  >
                    <X className="size-4" />
                  </AlertDialogCancel>
                </div>
                <AlertDialogDescription asChild>
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Are you sure you want to remove{" "}
                      <span className="font-semibold text-foreground">
                        {holidayToDelete?.name}
                      </span>
                      ? This action cannot be undone.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex flex-col-reverse gap-2 px-6 pb-6 sm:flex-row sm:justify-end">
                <AlertDialogCancel
                  disabled={removingHolidayId !== null}
                  className="h-10 px-4"
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={removingHolidayId !== null}
                  onClick={async () => {
                    if (!holidayToDelete) return;
                    await removeHoliday(holidayToDelete);
                    setHolidayToDelete(null);
                  }}
                  className="h-10 px-4 border-red-600 bg-background text-red-600 hover:border-red-600 hover:bg-red-50 hover:text-red-600 disabled:border-red-300 disabled:bg-background disabled:text-red-300 disabled:opacity-100 dark:hover:bg-red-950/30"
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

function Section({
  step,
  title,
  hint,
  optional,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className={CARD}>
      <CardHeader className="flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-accent text-sm font-bold text-brand-accent-foreground">
          {step}
        </span>
        <div className="space-y-0.5">
          <CardTitle className="text-base font-semibold  text-gray-900">
            {title}
            {optional && (
              <span className="ml-1 text-xs font-normal text-gray-500">
                (Optional)
              </span>
            )}
          </CardTitle>
          {hint && (
            <CardDescription className="text-xs text-gray-500">
              {hint}
            </CardDescription>
          )}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function AppliesToOption({
  value,
  selected,
  disabled,
  title,
  body,
}: {
  value: SlaAppliesTo;
  selected: boolean;
  disabled?: boolean;
  title: string;
  body: string;
}) {
  const id = `applies-to-${value.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3.5 transition-colors",
        disabled
          ? "cursor-not-allowed border-gray-200 opacity-60"
          : selected
            ? "cursor-pointer border-brand-accent bg-brand-accent/5"
            : "cursor-pointer border-gray-200 hover:bg-gray-50",
      )}
    >
      <RadioGroupItem
        id={id}
        value={value}
        disabled={disabled}
        className="mt-0.5"
      />
      <span className="space-y-0.5">
        <span className="block text-sm font-semibold text-gray-900">
          {title}
        </span>
        <span className="block text-xs text-gray-500">{body}</span>
      </span>
    </label>
  );
}

/**
 * "Default SLA". The current default can't be unticked — there must always be
 * one — so it changes only by ticking it on another policy, which the hint
 * spells out (the old default is set inactive by that save).
 */
function DefaultSlaCheckbox({
  checked,
  isCurrentDefault,
  currentDefaultName,
  onCheckedChange,
}: {
  checked: boolean;
  isCurrentDefault: boolean;
  currentDefaultName: string | null;
  onCheckedChange: (checked: boolean) => void;
}) {
  const note = isCurrentDefault
    ? "This is your default SLA. To change it, mark another policy as the default."
    : checked && currentDefaultName
      ? `Saving makes this the default instead of “${currentDefaultName}”, which will be set to Inactive.`
      : null;

  return (
    <div
      className={cn(
        "rounded-xl border p-3.5 transition-colors",
        checked ? "border-brand-accent bg-brand-accent/5" : "border-gray-200",
      )}
    >
      <label
        className={cn(
          "flex items-start gap-3",
          isCurrentDefault ? "cursor-not-allowed" : "cursor-pointer",
        )}
      >
        <CheckboxPrimitive.Root
          checked={checked}
          disabled={isCurrentDefault}
          onCheckedChange={(v) => onCheckedChange(v === true)}
          className="mt-0.5 aspect-square size-4 shrink-0 rounded-full border border-input text-white transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed data-[state=checked]:border-brand-accent data-[state=checked]:bg-brand-accent"
        >
          <CheckboxPrimitive.Indicator className="grid place-content-center [&>svg]:size-2">
            <CircleIcon className="fill-current" />
          </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
        <span className="space-y-0.5">
          <span className="block text-sm font-semibold text-gray-900">
            Default SLA
          </span>
          <span className="block text-xs text-gray-500">
            This policy will be used when no customer-specific SLA matches.
          </span>
        </span>
      </label>
      {note && <p className="mt-2 pl-7 text-xs text-gray-600">{note}</p>}
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium text-gray-800">
        {label}
        {required && <span className="text-red-500">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ChoiceCard({
  selected,
  onSelect,
  disabled,
  icon: Icon,
  title,
  body,
}: {
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? "border-brand-accent bg-brand-accent/5"
          : "border-gray-200 hover:bg-gray-50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-brand-accent" : "border-gray-300",
        )}
      >
        {selected && <span className="size-2.5 rounded-full bg-brand-accent" />}
      </span>
      <Icon
        className={cn(
          "mt-0.5 size-6 shrink-0",
          selected ? "text-brand-accent" : "text-gray-500",
        )}
      />
      <span className="space-y-1">
        <span className="block text-sm font-semibold text-gray-900">
          {title}
        </span>
        <span className="block text-xs leading-relaxed text-gray-500">
          {body}
        </span>
      </span>
    </button>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
  bare,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  bare?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3", !bare && "px-4 py-3")}>
      <Icon className="size-5 shrink-0 text-gray-500" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">{label}</p>
        <p className="truncate text-xs text-gray-500">{value}</p>
      </div>
    </div>
  );
}

function DurationInputs({
  label,
  value,
  invalid,
  onChange,
}: {
  label: string;
  value: DurationInput;
  invalid: boolean;
  onChange: (patch: Partial<DurationInput>) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        inputMode="numeric"
        className="h-9 w-24 border-gray-200 text-sm"
        value={value.amount}
        aria-label={`${label} amount`}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange({ amount: toDigits(e.target.value) })}
      />
      <Select
        value={value.unit}
        onValueChange={(v) => onChange({ unit: v as Unit })}
      >
        <SelectTrigger
          className="min-h-9 w-32 border-gray-200 text-sm"
          aria-label={`${label} unit`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          side="bottom"
          align="start"
          position="popper"
          className="p-1"
        >
          {(Object.keys(UNIT_MINS) as Unit[]).map((u) => (
            <SelectItem key={u} value={u} className="p-2  cursor-pointer">
              {unitLabel(u, value.amount)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** An unnumbered card with an icon tile; dims its header while locked. */
function IconCard({
  ref,
  icon: Icon,
  title,
  hint,
  optional,
  solid,
  locked,
  action,
  children,
}: {
  ref?: React.Ref<HTMLDivElement>;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  optional?: boolean;
  /** Filled accent tile instead of the tinted one. */
  solid?: boolean;
  locked?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card ref={ref} className={cn(CARD, "scroll-mt-6")}>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div
          className={cn(
            "flex min-w-0 items-start gap-3",
            locked && "opacity-50",
          )}
        >
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg",
              locked
                ? "bg-gray-100 text-gray-500"
                : solid
                  ? "bg-brand-accent text-brand-accent-foreground"
                  : "bg-brand-accent/10 text-brand-accent",
            )}
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <CardTitle className="text-base font-semibold text-gray-900">
              {title}
              {optional && (
                <span className="ml-1 text-xs font-normal text-gray-500">
                  (Optional)
                </span>
              )}
            </CardTitle>
            {hint && (
              <CardDescription className="text-xs text-gray-500">
                {hint}
              </CardDescription>
            )}
          </div>
        </div>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** A skeleton of the card's content with a lock message over it. */
function LockedPreview({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-35 flex-col items-center justify-center rounded-xl bg-gray-50 px-4 text-center">
      <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-white text-gray-400 ring-1 ring-gray-200">
        <Lock className="size-4" aria-hidden />
      </span>

      <p className="text-sm font-semibold text-gray-900">{title}</p>

      <p className="mt-1 text-xs text-gray-500">{body}</p>
    </div>
  );
}

function BusinessHoursSummary({
  workingDays,
  workingHours,
  holidayCount,
}: {
  workingDays: string;
  workingHours: string;
  holidayCount: number;
  onManageHolidays?: () => void;
}) {
  return (
    <Card className="gap-0 border border-gray-200 py-0 shadow-none ring-0">
      <div className="grid grid-cols-1 divide-y divide-gray-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <Fact icon={CalendarDays} label="Working days" value={workingDays} />
        <Fact icon={Clock} label="Working hours" value={workingHours} />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <TreePalm className="size-4" aria-hidden />
          {holidayCount} holiday{holidayCount !== 1 ? "s" : ""} configured
        </div>
      </div>
    </Card>
  );
}

function HolidaysTable({
  holidays,
  removingId,
  onEdit,
  onRemove,
}: {
  holidays: SlaHoliday[];
  removingId?: string | null;
  onEdit?: (holiday: SlaHoliday) => void;
  onRemove?: (holiday: SlaHoliday) => void;
}) {
  const sorted = [...holidays].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className={cn(INSET_TABLE, HOLIDAY_TABLE_SCROLL)}>
      <Table className="min-w-120">
        <TableHeader className="sticky top-0 z-10 bg-gray-50 shadow-[inset_0_-1px_0_var(--color-gray-200)]">
          <TableRow className={TABLE_HEAD_ROW}>
            <TableHead className={cn(TH, "px-4")}>Holiday name</TableHead>
            <TableHead className={cn(TH, "px-4")}>Date</TableHead>
            <TableHead className={cn(TH, "px-4")}>Repeat</TableHead>
            <TableHead className="w-20 px-4">
              <span className="">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={5}
                // Fills the three-row body so the message sits centred.
                className="h-39.5 px-4 text-center text-gray-500"
              >
                No holidays configured yet.
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((h) => (
              <TableRow key={h.id} className="border-gray-100">
                <TableCell className="max-w-40 truncate px-4 py-3 font-semibold text-gray-900">
                  {h.name}
                </TableCell>
                <TableCell className="px-4 py-3 text-gray-700">
                  {formatHolidayDate(h)}
                </TableCell>
                <TableCell className="px-4 py-3">
                  <Badge
                    className={cn(
                      BADGE,
                      h.repeatsYearly ? BADGE_TONES.emerald : BADGE_TONES.slate,
                    )}
                  >
                    {h.repeatsYearly ? "Yearly" : "Once"}
                  </Badge>
                </TableCell>
                <TableCell className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => onEdit?.(h)}
                      aria-label={`Edit ${h.name}`}
                      className="rounded-md p-1.5 text-brand-accent transition-colors hover:bg-brand-accent/10"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove?.(h)}
                      disabled={removingId === h.id}
                      aria-label={`Remove ${h.name}`}
                      className="rounded-md p-1.5 text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
