"use client";

import React from "react";
import {
  BarChart3,
  AreaChart as AreaIcon,
  Inbox,
  CheckCheck,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ReportsData, TrendPoint } from "../types/types";
import { REPORT_CARD } from "./styles";

const SERIES = [
  { key: "opened", label: "Opened", color: "var(--chart-opened)" },
  { key: "resolved", label: "Resolved", color: "var(--chart-resolved)" },
] as const;

const AXIS_TICK = { fill: "var(--chart-axis)", fontSize: 11 };

const BAR_GAP = 2;

interface CenteredBarProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: TrendPoint;
}

/**
 * Recharts always reserves a slot for both series, so a bucket with only one
 * non-zero series draws its bar off to one side of the tick. Slide that lone
 * bar into the middle of the bucket instead.
 */
function centeredBar(seriesIndex: number) {
  const sibling = SERIES[1 - seriesIndex].key;

  return function CenteredBar(props: CenteredBarProps) {
    const { x = 0, width = 0, payload } = props;
    const alone = payload !== undefined && payload[sibling] === 0;
    const shift = alone
      ? ((width + BAR_GAP) / 2) * (seriesIndex === 0 ? 1 : -1)
      : 0;

    return <Rectangle {...props} x={x + shift} radius={[4, 4, 0, 0]} />;
  };
}

const BAR_SHAPES = SERIES.map((_, index) => centeredBar(index));

interface TrendTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: TrendPoint }>;
}

function TrendTooltip({ active, payload }: TrendTooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="min-w-56 rounded-xl border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg">
      <p className="mb-2 border-b pb-2 font-bold text-foreground">
        {point.title}
      </p>
      {SERIES.map((series) => (
        <div
          key={series.key}
          className="flex items-center justify-between gap-8 py-1"
        >
          <span className="flex items-center gap-2 text-muted-foreground">
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{ background: series.color }}
            />
            {series.label}
          </span>
          <span className="text-base font-bold tabular-nums text-foreground">
            {point[series.key]}
          </span>
        </div>
      ))}
    </div>
  );
}

interface TicketPerformanceCardProps {
  data: ReportsData;
}

export function TicketPerformanceCard({ data }: TicketPerformanceCardProps) {
  const [kind, setKind] = React.useState<"bar" | "area">("bar");
  const points = data.trend;
  // useId can contain characters that break url(#…) references.
  const gradientId = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");

  return (
    <Card className={REPORT_CARD}>
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Support Ticket Performance
          </h2>
          <p className="text-sm text-muted-foreground">
            Opened vs resolved tickets over time
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-10 items-center gap-4 rounded-lg border px-4 text-sm text-muted-foreground">
            {SERIES.map((series) => (
              <span key={series.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ background: series.color }}
                />
                {series.label}
              </span>
            ))}
          </div>

          <div
            role="group"
            aria-label="Chart type"
            className="flex h-10 items-center gap-0.5 rounded-lg border p-1"
          >
            {(
              [
                { value: "bar", label: "Bar chart", Icon: BarChart3 },
                { value: "area", label: "Area chart", Icon: AreaIcon },
              ] as const
            ).map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                aria-label={label}
                aria-pressed={kind === value}
                onClick={() => setKind(value)}
                className={cn(
                  "flex h-full w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground",
                  kind === value && "bg-muted text-foreground",
                )}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-5 md:flex-row md:items-stretch">
        <div className="flex shrink-0 gap-4 border-b pb-4 md:w-40 md:flex-col md:justify-center md:border-r md:border-b-0 md:pb-0 md:pr-5">
          <div className="flex-1 md:flex-none">
            <Inbox className="size-5 text-chart-opened" aria-hidden />
            <p className="mt-2 text-sm text-muted-foreground">Open Tickets</p>
            <p className="text-3xl font-bold tabular-nums text-foreground">
              {data.summary.openBacklog}
            </p>
            <p className="text-xs text-muted-foreground">Currently open</p>
          </div>
          <div className="hidden border-t md:block" />
          <div className="flex-1 md:flex-none">
            <CheckCheck className="size-5 text-chart-resolved" aria-hidden />
            <p className="mt-2 text-sm text-muted-foreground">
              Resolved Tickets
            </p>
            <p className="text-3xl font-bold tabular-nums text-foreground">
              {data.summary.ticketsSolved}
            </p>
            <p className="text-xs text-muted-foreground">In this period</p>
          </div>
        </div>

        {/* Only grows sideways from md up. In the stacked (column) layout a
            flex-1 here becomes a 0px height basis and the chart vanishes. */}
        <div className="h-56 w-full min-w-0 sm:h-96 md:w-auto md:flex-1">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            {kind === "bar" ? (
              <BarChart
                data={points}
                margin={{ top: 8, right: 4, left: -20, bottom: 0 }}
                barGap={BAR_GAP}
                barCategoryGap="20%"
              >
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={AXIS_TICK}
                  minTickGap={12}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={AXIS_TICK}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                  content={(props) => <TrendTooltip {...props} />}
                />
                {SERIES.map((series, index) => (
                  <Bar
                    key={series.key}
                    dataKey={series.key}
                    name={series.label}
                    fill={series.color}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={40}
                    shape={BAR_SHAPES[index]}
                  />
                ))}
              </BarChart>
            ) : (
              <AreaChart
                data={points}
                margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
              >
                <defs>
                  {SERIES.map((series) => (
                    <linearGradient
                      key={series.key}
                      id={`${gradientId}-${series.key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={series.color}
                        stopOpacity={0.35}
                      />
                      <stop
                        offset="100%"
                        stopColor={series.color}
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={AXIS_TICK}
                  minTickGap={12}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={AXIS_TICK}
                />
                <Tooltip
                  cursor={{ stroke: "var(--chart-axis)", strokeDasharray: 4 }}
                  content={(props) => <TrendTooltip {...props} />}
                />
                {SERIES.map((series) => (
                  <Area
                    key={series.key}
                    type="monotone"
                    dataKey={series.key}
                    name={series.label}
                    stroke={series.color}
                    strokeWidth={2}
                    fill={`url(#${gradientId}-${series.key})`}
                    dot={false}
                    activeDot={{
                      r: 4,
                      strokeWidth: 2,
                      stroke: "var(--card)",
                    }}
                  />
                ))}
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}
