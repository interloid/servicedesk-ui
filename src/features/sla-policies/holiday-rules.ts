import { SlaHoliday } from "./types/types";

export const DUPLICATE_HOLIDAY_MESSAGE =
  "A holiday already exists for this date. Please choose another date.";

/**
 * The existing holiday already on `date`, if any. A yearly holiday covers its
 * day in every year, so it clashes on month and day alone. Shared by the
 * dialog (live message) and the server actions (which enforce it).
 */
export function findHolidayOnDate(
  holidays: SlaHoliday[],
  candidate: { date: string; repeatsYearly: boolean },
  excludeId?: string,
): SlaHoliday | undefined {
  if (!candidate.date) return undefined;
  const monthDay = candidate.date.slice(5);
  return holidays.find(
    (h) =>
      h.id !== excludeId &&
      (h.date === candidate.date ||
        ((h.repeatsYearly || candidate.repeatsYearly) &&
          h.date.slice(5) === monthDay)),
  );
}
