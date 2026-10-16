import { Skeleton } from "@/components/ui/skeleton";

/**
 * Without this file Next.js has no fallback for the async page beside it, so a
 * click leaves the previous screen up until every query has finished — which
 * reads as a dead link and gets clicked again.
 *
 * The shapes below mirror BrandingEditor at every breakpoint (same padding, the
 * same two-column grid from xl, the same container queries inside each card)
 * so nothing jumps when the data lands. The preview is drawn in its default
 * Desktop frame, since that is what the page opens on.
 */

/** Matches PRESET_COLORS: seven swatches, then the "+" picker. */
const SWATCH_COUNT = 7;

const ACCENT = "bg-slate-300/70";
const SOFT = "bg-slate-200/80";

/** Varied widths stop the placeholder cards reading as one grey block. */
const SUBJECT_WIDTHS = ["w-36", "w-44", "w-32"];
const PREVIEW_WIDTHS = [
  "w-full max-w-96",
  "w-64 max-w-full",
  "w-56 max-w-full",
];
const META_WIDTHS = ["w-56", "w-60", "w-52"];

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
    <div className="@container flex min-w-0 flex-col rounded-[14px] border border-border bg-card p-4 sm:p-5">
      {/* Logo */}
      <Section>
        <SectionHeading titleWidth="w-12" descriptionWidth="w-96" />
        <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
          <div className="flex items-center gap-3 rounded-[12px] border border-border p-3.5">
            <Skeleton className={`size-14 shrink-0 rounded-[10px] ${ACCENT}`} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>

          <div className="flex min-h-22 flex-col items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-border bg-muted/40 p-3.5">
            <Skeleton className={`size-5 rounded ${SOFT}`} />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-[12px] border border-border px-3.5 py-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Skeleton className="h-4 w-52 max-w-full" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton
            className={`h-[1.15rem] w-8 shrink-0 rounded-full ${ACCENT}`}
          />
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
          <div className="flex max-w-[45%] min-w-0 flex-none items-center border-r border-input bg-muted px-3">
            <Skeleton className={`h-4 w-40 max-w-full ${SOFT}`} />
          </div>
          <div className="flex min-w-0 flex-1 items-center px-3">
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="flex flex-none items-center border-l border-input bg-muted px-3">
            <Skeleton className={`h-4 w-12 ${SOFT}`} />
          </div>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-start gap-2">
              <Skeleton className={`size-5 shrink-0 rounded-full ${SOFT}`} />
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
          <Skeleton className="mt-0.5 h-3 w-10 shrink-0" />
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

      {/* More options (collapsed by default) */}
      <div className="flex items-center justify-between gap-3 pt-4">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className={`size-4 shrink-0 rounded ${SOFT}`} />
      </div>
    </div>
  );
}

function RequestCard({ index }: { index: number }) {
  return (
    <div className="relative flex items-start gap-4 rounded-2xl border border-border bg-white p-4 shadow-xs @lg:p-5">
      <Skeleton
        className={`hidden size-12 shrink-0 rounded-xl @lg:block ${SOFT}`}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Skeleton
          className={`absolute top-5 right-5 h-6 w-20 rounded-full ${SOFT}`}
        />
        <div className="flex h-6 items-center">
          <Skeleton className="h-3 w-12" />
        </div>
        <Skeleton className={`mt-1 h-5 ${SUBJECT_WIDTHS[index]}`} />
        <Skeleton className={`mt-1.5 h-4 ${PREVIEW_WIDTHS[index]}`} />
        <div className="mt-2 flex items-center gap-1.5">
          <Skeleton className={`size-3.5 shrink-0 rounded-full ${SOFT}`} />
          <Skeleton className={`h-3 ${META_WIDTHS[index]} max-w-full`} />
        </div>
      </div>
    </div>
  );
}

function PreviewCard() {
  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-[14px] border border-border bg-card p-4 sm:p-5 xl:sticky xl:top-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Skeleton className={`size-11 shrink-0 rounded-[10px] ${SOFT}`} />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
        </div>

        {/* Desktop / Tablet / Mobile */}
        <div className="flex w-full items-center gap-1 rounded-[10px] border border-border p-1 *:flex-1 sm:w-auto sm:*:flex-none">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className={`flex items-center justify-center gap-1.5 rounded-[8px] px-2 py-1.5 sm:gap-2 sm:px-3 ${index === 0 ? "bg-muted" : ""}`}
            >
              <Skeleton className={`size-4 rounded ${SOFT}`} />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      </div>

      {/* Portal frame, Desktop variant */}
      <div className="@container w-full min-w-0 overflow-hidden rounded-[12px] border border-border">
        <div className="flex items-center gap-1.5 border-b border-border bg-muted px-3 py-2.5">
          <span className="size-2.5 rounded-full bg-slate-300" />
          <span className="size-2.5 rounded-full bg-slate-300" />
          <span className="size-2.5 rounded-full bg-slate-300" />
        </div>

        <div className="flex h-15 items-center justify-between gap-3 border-b border-border bg-slate-200/70 px-4 @lg:h-16 @lg:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <Skeleton className="size-8 shrink-0 rounded-md bg-slate-300/80" />
            <Skeleton className="h-5 w-36 bg-slate-300/80" />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Skeleton className="size-9 rounded-lg bg-slate-300/80 @lg:hidden" />
            <Skeleton className="hidden h-9 w-24 rounded-lg bg-slate-300/80 @lg:block" />
            <div className="hidden items-center gap-2 px-1.5 @lg:flex">
              <Skeleton className="size-8 rounded-full bg-slate-300/80" />
              <Skeleton className="h-4 w-28 bg-slate-300/80" />
            </div>
          </div>
        </div>

        <div className="bg-slate-50 px-4 py-8 @lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-2">
              <Skeleton className="h-8 w-44" />
              <Skeleton className="h-4 w-96 max-w-full" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
            <Skeleton className={`h-11 w-36 rounded-md ${ACCENT}`} />
          </div>

          <div className="mt-6 flex flex-col gap-3 @lg:flex-row">
            <div className="flex h-12 min-w-0 shrink-0 items-center gap-3 rounded-xl border border-border bg-white px-3.5 shadow-xs @lg:flex-1">
              <Skeleton className={`size-4.5 shrink-0 rounded ${SOFT}`} />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="flex h-12 w-full shrink-0 items-center justify-between gap-2 rounded-xl border border-border bg-white px-4 shadow-xs @lg:w-52">
              <Skeleton className="h-4 w-20" />
              <Skeleton className={`size-4 rounded ${SOFT}`} />
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-32" />
          </div>

          <div className="mt-3 flex flex-col gap-3">
            {SUBJECT_WIDTHS.map((_, index) => (
              <RequestCard key={index} index={index} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="h-full overflow-y-auto p-4 font-sans text-slate-900 sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-5 w-80 max-w-full" />
          </div>

          <div className="flex w-full flex-wrap items-center gap-3 *:flex-1 sm:w-auto sm:*:flex-none">
            <div className="flex h-10 items-center justify-center rounded-lg border bg-card px-4">
              <Skeleton className="h-4 w-28" />
            </div>
            <div
              className={`flex h-10 items-center justify-center rounded-lg px-4 ${ACCENT}`}
            >
              <Skeleton className={`h-4 w-24 ${SOFT}`} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <SettingsCard />
          <PreviewCard />
        </div>
      </div>
    </div>
  );
}
