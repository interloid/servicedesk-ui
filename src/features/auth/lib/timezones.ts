export type Timezone = {
  id: string;
  /**
   * IANA zone name, matching `public.timezones.code`.
   *
   * The design's own list carries only these short ids ("ist", "pst"), which exist nowhere
   * in the database — `business_hours.timezone_id` is a UUID foreign key into
   * `public.timezones`. This field is the join: id (what the Select binds) → iana (what the
   * table stores) → row id (what gets written).
   */
  iana: string;
  /** UTC offset, e.g. "+05:30". */
  offset: string;
  label: string;
  cities: string;
};

/**
 * Transcribed verbatim from `Update design.dc.html` → `const TIMEZONES`, in source order.
 * Drives the create-org / onboarding Select and its hint line.
 *
 * `iana` is the one field the design did not have — see the type above for why it's needed.
 * All sixteen resolve against the `public.timezones` seed except two: "brt"
 * (America/Sao_Paulo) and "eet" (Europe/Athens) were absent, and were added to
 * supabase/schemas/seeds/02_timezone_seed.sql so every option in the Select is selectable.
 */
export const TIMEZONES: Timezone[] = [
  {
    id: "pst",
    iana: "America/Los_Angeles",
    offset: "-08:00",
    label: "(GMT-08:00) Pacific Time",
    cities: "Los Angeles · Vancouver",
  },
  {
    id: "mst",
    iana: "America/Denver",
    offset: "-07:00",
    label: "(GMT-07:00) Mountain Time",
    cities: "Denver · Phoenix",
  },
  {
    id: "cst",
    iana: "America/Chicago",
    offset: "-06:00",
    label: "(GMT-06:00) Central Time",
    cities: "Chicago · Mexico City",
  },
  {
    id: "est",
    iana: "America/New_York",
    offset: "-05:00",
    label: "(GMT-05:00) Eastern Time",
    cities: "New York · Toronto",
  },
  {
    id: "brt",
    iana: "America/Sao_Paulo",
    offset: "-03:00",
    label: "(GMT-03:00) Brasília Time",
    cities: "São Paulo · Buenos Aires",
  },
  {
    id: "utc",
    iana: "UTC",
    offset: "+00:00",
    label: "(GMT+00:00) Coordinated Universal Time",
    cities: "Reykjavík · Accra",
  },
  {
    id: "bst",
    iana: "Europe/London",
    offset: "+01:00",
    label: "(GMT+01:00) British Summer Time",
    cities: "London · Dublin · Lisbon",
  },
  {
    id: "cet",
    iana: "Europe/Paris",
    offset: "+02:00",
    label: "(GMT+02:00) Central European Summer",
    cities: "Berlin · Paris · Madrid",
  },
  {
    id: "eet",
    iana: "Europe/Athens",
    offset: "+03:00",
    label: "(GMT+03:00) Eastern European · Moscow",
    cities: "Athens · Moscow · Nairobi",
  },
  {
    id: "gst",
    iana: "Asia/Dubai",
    offset: "+04:00",
    label: "(GMT+04:00) Gulf Standard Time",
    cities: "Dubai · Muscat",
  },
  {
    id: "ist",
    iana: "Asia/Kolkata",
    offset: "+05:30",
    label: "(GMT+05:30) India Standard Time",
    cities: "Mumbai · Bengaluru · Chennai",
  },
  {
    id: "ict",
    iana: "Asia/Bangkok",
    offset: "+07:00",
    label: "(GMT+07:00) Indochina Time",
    cities: "Bangkok · Jakarta · Hanoi",
  },
  {
    id: "sgt",
    iana: "Asia/Singapore",
    offset: "+08:00",
    label: "(GMT+08:00) Singapore · China Standard",
    cities: "Singapore · Shanghai · Perth",
  },
  {
    id: "jst",
    iana: "Asia/Tokyo",
    offset: "+09:00",
    label: "(GMT+09:00) Japan Standard Time",
    cities: "Tokyo · Seoul",
  },
  {
    id: "aet",
    iana: "Australia/Sydney",
    offset: "+10:00",
    label: "(GMT+10:00) Australian Eastern",
    cities: "Sydney · Melbourne · Brisbane",
  },
  {
    id: "nzt",
    iana: "Pacific/Auckland",
    offset: "+12:00",
    label: "(GMT+12:00) New Zealand Standard",
    cities: "Auckland · Wellington",
  },
];

/** The design seeds `tz: "ist"`. */
export const DEFAULT_TIMEZONE_ID = "ist";

/** The design's `tzHint`: `"UTC " + z.off + " · " + z.cities`. */
export function timezoneHint(id: string): string {
  const zone = TIMEZONES.find((z) => z.id === id) ?? TIMEZONES[10]!;
  return `UTC ${zone.offset} · ${zone.cities}`;
}
