import { Skeleton } from "@/components/ui/skeleton";

/**
 * Without this file Next.js has no fallback for the async page beside it, so a
 * click leaves the previous screen up until every query has finished — which
 * reads as a dead link and gets clicked again.
 *
 * The shapes below mirror BrandingEditor at every breakpoint (same padding, the
 * same two-column grid from xl, the same container queries inside each card)
 * so nothing jumps when the data lands. More options is drawn open, since
 * that is how the page opens.
 */

/** Matches PRESET_COLORS: seven swatches, then the "+" picker. */
const SWATCH_COUNT = 7;

const ACCENT = "bg-slate-300/70";
const SOFT = "bg-slate-200/80";

/** More options: secondary, text and background colours, then support email. */
const MORE_FIELD_WIDTHS = [
  { label: "w-32", hint: "w-72" },
  { label: "w-24", hint: "w-64" },
  { label: "w-36", hint: "w-64" },
  { label: "w-28", hint: "w-40" },
];

/** The preview gallery: three screens on the top row, four below (12 cols). */
const SCREEN_SPANS = [4, 4, 4, 3, 3, 3, 3];
const SCREEN_TITLE_WIDTHS = [
  "w-24",
  "w-32",
  "w-20",
  "w-28",
  "w-24",
  "w-32",
  "w-24",
];

function SectionHeading({
  titleWidth,
  descriptionWidth,
}: {
  titleWidth: string;
  descriptionWidth: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Skeleton className={`h-5 ${titleWidth}`} />
      <Skeleton className={`h-4 ${descriptionWidth} max-w-full`} />
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-5 not-first:pt-5">
      {children}
    </div>
  );
}

function SettingsCard() {
  return (
    <div className="@container flex min-w-0 flex-col rounded-[14px] border border-border bg-card p-4 sm:p-5 xl:overflow-y-auto">
      {/* Logo */}
      <Section>
        <SectionHeading titleWidth="w-12" descriptionWidth="w-96" />
        <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
          <div className="relative flex items-center gap-3 rounded-[12px] border border-border p-3.5">
            <Skeleton className={`size-14 shrink-0 rounded-[10px] ${ACCENT}`} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 pr-24">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="absolute top-3 right-3.5 flex items-center gap-2">
              <Skeleton className="h-3 w-14" />
              <Skeleton
                className={`h-[1.15rem] w-8 shrink-0 rounded-full ${ACCENT}`}
              />
            </div>
          </div>

          <div className="flex min-h-22 flex-col items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-border bg-muted/40 p-3.5">
            <Skeleton className={`size-5 rounded ${SOFT}`} />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
      </Section>

      {/* Display name */}
      <Section>
        <SectionHeading titleWidth="w-28" descriptionWidth="w-96" />
        <div className="flex h-11 items-center justify-between rounded-sm border border-input px-3 md:h-10.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-10" />
        </div>
      </Section>

      {/* Portal address */}
      <Section>
        <SectionHeading titleWidth="w-32" descriptionWidth="w-96" />
        <div className="flex h-11 items-stretch overflow-hidden rounded-sm border border-input md:h-10.5">
          <div className="hidden max-w-[45%] min-w-0 flex-none items-center border-r border-input bg-muted px-3 @sm:flex">
            <Skeleton className={`h-4 w-40 max-w-full ${SOFT}`} />
          </div>
          <div className="flex min-w-0 flex-1 items-center px-3">
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="flex flex-none items-center pr-3">
            <Skeleton className="h-3 w-10" />
          </div>
          <div className="hidden flex-none items-center border-l border-input bg-muted px-3 @sm:flex">
            <Skeleton className={`h-4 w-12 ${SOFT}`} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-start gap-2">
            <Skeleton
              className={`mt-0.5 size-4 shrink-0 rounded-full ${SOFT}`}
            />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      </Section>

      {/* Brand colour */}
      <Section>
        <SectionHeading titleWidth="w-28" descriptionWidth="w-full max-w-md" />
        <div className="flex flex-wrap items-center gap-2.5">
          {Array.from({ length: SWATCH_COUNT }).map((_, index) => (
            <Skeleton
              key={index}
              className={`size-10 rounded-full @sm:size-11 ${index === 0 ? ACCENT : SOFT}`}
            />
          ))}
          <div className="size-10 rounded-full border border-border @sm:size-11" />
          <div className="flex h-11 w-full items-center rounded-sm border border-input px-3 @sm:w-32 md:h-10.5">
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
        <div className="flex items-start gap-2.5 rounded-[10px] bg-muted/60 px-3.5 py-3">
          <Skeleton
            className={`mt-px size-5 shrink-0 rounded-full ${ACCENT}`}
          />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </Section>

      {/* More options (open by default) */}
      <div className="flex items-center justify-between gap-3 pt-4">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className={`size-4 shrink-0 rounded ${SOFT}`} />
      </div>
      <div className="grid grid-cols-1 gap-4 pt-4 @xl:grid-cols-2">
        {MORE_FIELD_WIDTHS.map((widths, index) => (
          <div key={index} className="flex flex-col gap-1.5">
            <Skeleton className={`h-4 ${widths.label}`} />
            <div className="flex items-center gap-2.5">
              {index < 3 && (
                <Skeleton
                  className={`size-11 shrink-0 rounded-sm md:size-10.5 ${SOFT}`}
                />
              )}
              <div className="flex h-11 min-w-0 flex-1 items-center rounded-sm border border-input px-3 md:h-10.5">
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
            <Skeleton className={`h-3 ${widths.hint} max-w-full`} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ScreenCard({ index }: { index: number }) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-slate-100 p-2.5 ${
        SCREEN_SPANS[index] === 4 ? "@4xl:col-span-4" : "@4xl:col-span-3"
      }`}
    >
      <div className="flex items-center gap-2.5 px-0.5">
        <Skeleton className="size-7 shrink-0 rounded-lg bg-white" />
        <Skeleton className={`h-4 ${SCREEN_TITLE_WIDTHS[index]}`} />
      </div>
      <div className="flex h-56 flex-col gap-2 rounded-lg border border-border bg-white p-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="mt-2 h-7 w-full rounded-md bg-white" />
        <Skeleton className={`h-7 w-full rounded-md ${ACCENT}`} />
      </div>
    </div>
  );
}

function PreviewCard() {
  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-[14px] border border-border bg-card p-4 sm:p-5 xl:overflow-hidden">
      <div className="flex items-start gap-3">
        <Skeleton className={`size-11 shrink-0 rounded-[10px] ${SOFT}`} />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      </div>

      {/* Portal frame */}
      <div className="@container flex w-full min-w-0 flex-col overflow-hidden rounded-[12px] border border-border xl:min-h-0 xl:flex-1">
        <div className="flex items-center gap-1.5 border-b border-border bg-muted px-3 py-2.5">
          <span className="size-2.5 rounded-full bg-slate-300" />
          <span className="size-2.5 rounded-full bg-slate-300" />
          <span className="size-2.5 rounded-full bg-slate-300" />
        </div>

        <div className="flex h-14 items-center justify-between gap-3 border-b border-border bg-slate-200/70 px-4 @lg:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Skeleton className="size-8 shrink-0 rounded-md bg-slate-300/80" />
            <Skeleton className="h-5 w-36 bg-slate-300/80" />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Skeleton className="size-9 rounded-lg bg-slate-300/80 @lg:hidden" />
            <Skeleton className="hidden h-9 w-24 rounded-lg bg-slate-300/80 @lg:block" />
            <div className="hidden items-center gap-2 px-1.5 @lg:flex">
              <Skeleton className="size-7 rounded-full bg-slate-300/80" />
              <Skeleton className="h-4 w-28 bg-slate-300/80" />
            </div>
          </div>
        </div>

        <div className="grid max-h-[70vh] grid-cols-1 gap-3 overflow-y-auto bg-white p-3 @xl:grid-cols-2 @4xl:grid-cols-12 xl:max-h-none xl:min-h-0 xl:flex-1">
          {SCREEN_SPANS.map((_, index) => (
            <ScreenCard key={index} index={index} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="h-full overflow-y-auto p-4 font-sans text-slate-900 sm:p-6 lg:p-8 xl:overflow-hidden">
      <div className="mx-auto flex w-full flex-col gap-6 xl:h-full">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-5 w-80 max-w-full" />
          </div>

          <div className="flex w-full flex-wrap items-center gap-3 *:flex-1 sm:w-auto sm:*:flex-none">
            <div className="flex h-9 items-center justify-center rounded-lg border bg-card px-3.5">
              <Skeleton className="h-4 w-28" />
            </div>
            <div
              className={`flex h-9 items-center justify-center rounded-lg px-3.5 ${ACCENT}`}
            >
              <Skeleton className={`h-4 w-24 ${SOFT}`} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)] xl:grid-rows-[minmax(0,1fr)] xl:items-stretch">
          <SettingsCard />
          <PreviewCard />
        </div>
      </div>
    </div>
  );
}
