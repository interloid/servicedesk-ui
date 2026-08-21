"use client";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { OnboardingState, WorkingDay } from "../types/onboarding";
import { useWatch } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface Timezone {
  id: string;
  display_name?: string;
  label?: string;
  cities?: string;
  utc_offset?: string;
}

interface StepProps {
  data: OnboardingState;
  timezones?: Timezone[];
  onChange: (data: Partial<OnboardingState>) => void;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
}

const DAYS: WorkingDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const businessHoursSchema = z.object({
  timezone_id: z.string().min(1, "Please select a time zone."),
  workingDays: z
    .array(z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]))
    .min(1, "Select at least one working day."),
  dayStarts: z.string().min(1, "Start time is required."),
  dayEnds: z.string().min(1, "End time is required."),
});

type BusinessHoursFormValues = z.infer<typeof businessHoursSchema>;

export function StepBusinessHours({
  data,
  timezones = [],
  onChange,
  onNext,
  onSkip,
  onBack,
}: StepProps) {
  const tzList = Array.isArray(timezones) ? timezones : [];

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<BusinessHoursFormValues>({
    resolver: zodResolver(businessHoursSchema),
    defaultValues: {
      timezone_id: data.timezone_id || "",
      workingDays: data.workingDays || ["Mon", "Tue", "Wed", "Thu", "Fri"],
      dayStarts: data.dayStarts || "09:00",
      dayEnds: data.dayEnds || "18:30",
    },
  });

  const selectedTzId = useWatch({
    control,
    name: "timezone_id",
  });

  const selectedWorkingDays = useWatch({
    control,
    name: "workingDays",
  });

  const selectedTz = tzList.find((tz) => tz.id === selectedTzId);

  const toggleDay = (day: WorkingDay) => {
    const updated = selectedWorkingDays.includes(day)
      ? selectedWorkingDays.filter((d) => d !== day)
      : [...selectedWorkingDays, day];

    setValue("workingDays", updated, {
      shouldValidate: true,
    });
  };

  const handleBusinessHoursSubmit = (values: BusinessHoursFormValues) => {
    onChange(values);
    onNext();
  };

  return (
    <div className="w-full space-y-6">
      <div className="space-y-1">
        <span className="text-xs font-bold tracking-wider text-emerald-800 uppercase">
          Set up Northwind Support
        </span>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Three steps and your queue is live.
        </h2>
      </div>

      <form
        onSubmit={handleSubmit(handleBusinessHoursSubmit)}
        className="space-y-6 text-left"
      >
        <div>
          <h3 className="text-base font-bold text-slate-900 mb-4">
            When is your team on shift?
          </h3>

          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-slate-800">
                Time zone
              </Label>
              <Controller
                name="timezone_id"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full h-11 rounded-lg border-slate-300 text-slate-800 focus:ring-emerald-700">
                      <SelectValue placeholder="Select a timezone" />
                    </SelectTrigger>
                    <SelectContent className="w-(--radix-select-trigger-width)">
                      {tzList.map((tz) => (
                        <SelectItem key={tz.id} value={tz.id}>
                          {tz.display_name || tz.label || tz.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {selectedTz && (
                <p className="text-xs text-slate-500">
                  {selectedTz.utc_offset && `${selectedTz.utc_offset} · `}
                  {selectedTz.cities || selectedTz.display_name}
                </p>
              )}
              {errors.timezone_id && (
                <p className="text-xs font-medium text-destructive">
                  {errors.timezone_id.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-slate-800">
                Working days
              </Label>
              <div className="flex flex-wrap gap-2 pt-1">
                {DAYS.map((day) => {
                  const isSelected = selectedWorkingDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={cn(
                        "px-3.5 py-2 text-xs font-semibold rounded-xl border transition-all",
                        isSelected
                          ? "border-emerald-700 bg-emerald-50/50 text-emerald-800"
                          : "border-slate-200 bg-white text-slate-400 hover:border-slate-300",
                      )}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
              {errors.workingDays && (
                <p className="text-xs font-medium text-destructive">
                  {errors.workingDays.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 pt-1">
              <div className="space-y-1.5">
                <Label
                  htmlFor="dayStarts"
                  className="text-sm font-semibold text-slate-800"
                >
                  Day starts
                </Label>
                <Input
                  id="dayStarts"
                  type="time"
                  className="h-11 rounded-lg border-slate-300 text-slate-800 focus-visible:ring-emerald-700"
                  {...register("dayStarts")}
                />
                {errors.dayStarts && (
                  <p className="text-xs font-medium text-destructive">
                    {errors.dayStarts.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="dayEnds"
                  className="text-sm font-semibold text-slate-800"
                >
                  Day ends
                </Label>
                <Input
                  id="dayEnds"
                  type="time"
                  className="h-11 rounded-lg border-slate-300 text-slate-800 focus-visible:ring-emerald-700"
                  {...register("dayEnds")}
                />
                {errors.dayEnds && (
                  <p className="text-xs font-medium text-destructive">
                    {errors.dayEnds.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4">
          <Button
            type="button"
            variant="link"
            onClick={onBack}
            className="text-sm font-semibold text-emerald-800 hover:underline p-0 h-auto"
          >
            Back
          </Button>

          <div className="flex items-center space-x-3">
            <Button
              type="button"
              variant="outline"
              onClick={onSkip}
              className="h-11 px-5 border-slate-300 text-emerald-800 font-semibold rounded-lg hover:bg-slate-50"
            >
              Skip for now
            </Button>
            <Button
              type="submit"
              className="h-11 px-6 bg-emerald-800 hover:bg-emerald-900 text-white font-semibold rounded-lg transition-colors"
            >
              Continue
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
