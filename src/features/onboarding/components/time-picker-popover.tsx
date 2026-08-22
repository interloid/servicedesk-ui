import * as React from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface TimePickerPopoverProps {
  value?: string; // Form format: "09:00" (24h)
  onChange?: (val: string) => void;
  className?: string;
}

const HOURS = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
];
const MINUTES = Array.from({ length: 60 }, (_, i) =>
  i.toString().padStart(2, "0"),
);
const PERIODS = ["AM", "PM"];

export function TimePickerPopover({
  value = "09:00",
  onChange,
  className,
}: TimePickerPopoverProps) {
  const [open, setOpen] = React.useState(false);

  const hourContainerRef = React.useRef<HTMLDivElement>(null);
  const minuteContainerRef = React.useRef<HTMLDivElement>(null);

  const parseValue = React.useCallback((val: string) => {
    const [hStr, mStr] = val.split(":");
    let h = parseInt(hStr || "9", 10);
    const m = mStr || "00";
    const period = h >= 12 ? "PM" : "AM";
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return {
      hour: h.toString().padStart(2, "0"),
      minute: m.padStart(2, "0"),
      period,
    };
  }, []);

  const { hour, minute, period } = parseValue(value);

  React.useEffect(() => {
    if (open) {
      setTimeout(() => {
        const activeMinuteEl = minuteContainerRef.current?.querySelector(
          '[data-selected="true"]',
        );
        const activeHourEl = hourContainerRef.current?.querySelector(
          '[data-selected="true"]',
        );

        activeMinuteEl?.scrollIntoView({ block: "center", behavior: "smooth" });
        activeHourEl?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 50);
    }
  }, [open]);

  const handleSelect = (
    newHour: string,
    newMinute: string,
    newPeriod: string,
  ) => {
    let h = parseInt(newHour, 10);
    if (newPeriod === "PM" && h < 12) h += 12;
    if (newPeriod === "AM" && h === 12) h = 0;
    const formatted = `${h.toString().padStart(2, "0")}:${newMinute}`;
    onChange?.(formatted);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-11 w-full justify-between rounded-lg border-slate-300 bg-white px-3 text-left font-normal text-slate-800 shadow-sm hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-emerald-700",
            className,
          )}
        >
          <span className="font-medium text-slate-900">
            {hour}:{minute} {period}
          </span>
          <Clock className="h-4 w-4 text-slate-500" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex h-64 border rounded-md bg-white shadow-md divide-x divide-slate-100">
          <div
            ref={hourContainerRef}
            className="flex flex-col overflow-y-auto p-1 w-14 no-scrollbar"
          >
            {HOURS.map((h) => (
              <button
                key={h}
                type="button"
                data-selected={hour === h}
                onClick={() => handleSelect(h, minute, period)}
                className={cn(
                  "py-1.5 text-center text-sm rounded-sm my-0.5 transition-colors font-medium",
                  hour === h
                    ? "bg-emerald-700 text-white font-bold"
                    : "text-slate-700 hover:bg-emerald-50 hover:text-emerald-800",
                )}
              >
                {h}
              </button>
            ))}
          </div>

          <div
            ref={minuteContainerRef}
            className="flex flex-col overflow-y-auto p-1 w-14 no-scrollbar"
          >
            {MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                data-selected={minute === m}
                onClick={() => handleSelect(hour, m, period)}
                className={cn(
                  "py-1.5 text-center text-sm rounded-sm my-0.5 transition-colors font-medium",
                  minute === m
                    ? "bg-emerald-700 text-white font-bold"
                    : "text-slate-700 hover:bg-emerald-50 hover:text-emerald-800",
                )}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="flex flex-col p-1 w-14">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleSelect(hour, minute, p)}
                className={cn(
                  "py-1.5 text-center text-sm rounded-sm my-0.5 transition-colors font-medium",
                  period === p
                    ? "bg-emerald-700 text-white font-bold"
                    : "text-slate-700 hover:bg-emerald-50 hover:text-emerald-800",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
