import { PORTAL_BASE_DOMAIN } from "@/lib/tenancy";

export interface BrandingJson {
  logo_url?: string | null;
  primary_color?: string | null;
  /** Fills secondary buttons and quiet surfaces. Null = app default. */
  secondary_color?: string | null;
  /** Body text. Null = app default. */
  text_color?: string | null;
  /** Page background behind cards. Null = app default. */
  background_color?: string | null;
  support_email?: string | null;
  /** Portal header shows the logo; false = the initial. Absent = true. */
  show_logo_on_portal?: boolean;
}

// These mirror the :root block in globals.css. They are the values the app
// already paints with, so a tenant who leaves a field blank sees no change.
export const DEFAULT_BRAND_COLOR = "#0f766e";
export const DEFAULT_SECONDARY_COLOR = "#f1f5f9";
export const DEFAULT_TEXT_COLOR = "#0f172a";
export const DEFAULT_BACKGROUND_COLOR = "#f8fafc";

export const DEFAULT_SHOW_LOGO_ON_PORTAL = true;

export const PORTAL_DOMAIN = PORTAL_BASE_DOMAIN;

/** Mirrors the schema limits, so the editor's counters say what save enforces. */
export const MAX_NAME_LENGTH = 120;
export const MAX_SLUG_LENGTH = 63;

/**
 * Logos go to the public avatars bucket under `<tenant id>/branding/`, which is
 * what its insert policy keys on. SVG is left out on purpose: the bucket is
 * public and only allows raster types (see portal_rls_hardening).
 */
export const LOGO_BUCKET = "avatars";
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const LOGO_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type LogoUploadTarget = {
  path: string;
  /** Single-use, from createSignedUploadUrl. */
  token: string;
  publicUrl: string;
};

export type SlugAvailability = "available" | "current" | "taken" | "invalid";

export interface TenantBranding {
  name: string;
  slug: string;
  portalUrl: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  textColor: string | null;
  backgroundColor: string | null;
  supportEmail: string | null;
  showLogoOnPortal: boolean;
}

export const BRANDING_FAILURE_CODE_VALUES = [
  "validation",
  "action-not-allowed",
  "not-found",
  "slug-taken",
  "unknown",
] as const;

export type BrandingFailureCode = (typeof BRANDING_FAILURE_CODE_VALUES)[number];

export interface BrandingActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  failureCode?: BrandingFailureCode;
  message?: string;
}

export const BRANDING_OK: BrandingActionResult = { ok: true };

// ---------------------------------------------------------------------------
// Brand palette
// ---------------------------------------------------------------------------

/**
 * The tenant's chosen colours expand into the palette the app paints with.
 *
 * This lives here, in a module both the server and the client import, so the
 * branding preview and the running app derive their colours from the same
 * function. When the preview had its own idea of the palette it drifted: it
 * hard-coded white button text, while the app picks dark text on a light brand
 * colour — so a pale brand previewed as white-on-pale and shipped as
 * dark-on-pale.
 */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function channel(value: number): string {
  const clamped = Math.round(Math.min(255, Math.max(0, value)));
  return clamped.toString(16).padStart(2, "0");
}

function toHex(r: number, g: number, b: number): string {
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function shade(hex: string, factor: number): string {
  const [r, g, b] = parseHex(hex);
  const apply = (v: number) => v * (1 - factor);
  return toHex(apply(r), apply(g), apply(b));
}

function tint(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const mix = (v: number) => v + (255 - v) * amount;
  return toHex(mix(r), mix(g), mix(b));
}

/** Blend `from` toward `to` by `amount` (0 = from, 1 = to). */
function blend(from: string, to: string, amount: number): string {
  const [r1, g1, b1] = parseHex(from);
  const [r2, g2, b2] = parseHex(to);
  const at = (a: number, b: number) => a + (b - a) * amount;
  return toHex(at(r1, r2), at(g1, g2), at(b1, b2));
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio between two colours, 1 (identical) to 21 (black/white).
 *
 * Body text needs 4.5 to meet AA, large text 3. The editor uses this to warn
 * when a chosen pair would be hard to read — a warning, not a block: a brand is
 * the tenant's call, but shipping unreadable text without saying so is not.
 */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];

  return (hi + 0.05) / (lo + 0.05);
}

export const MIN_READABLE_CONTRAST = 4.5;

const INK = "#0f172a";
const PAPER = "#ffffff";

/**
 * The more legible of ink or paper on `background`.
 *
 * Chosen by measuring both, not by a luminance threshold. The old rule —
 * "luminance > 0.55 means use dark text" — picked the WORSE option for every
 * mid-tone brand. A dusty red like #c47b7b sits at luminance 0.27, so it got
 * white text at 3.25:1 when dark text would have scored 5.50:1; lime and orange
 * failed the same way. That is what made branded headers and buttons look
 * washed out: not a styling choice, a foreground picked against the evidence.
 */
function bestForeground(background: string, ink: string = INK): string {
  return contrastRatio(ink, background) > contrastRatio(PAPER, background)
    ? ink
    : PAPER;
}

/** Anything not a full 6-digit hex falls back to `fallback`. */
export function normalizeHexColor(
  value: string | null | undefined,
  fallback: string,
): string {
  const hex = value?.trim();

  return hex && HEX_COLOR.test(hex) ? hex.toLowerCase() : fallback;
}

export function isHexColor(value: string | null | undefined): boolean {
  return Boolean(value && HEX_COLOR.test(value.trim()));
}

/** The colours a tenant can set. Null means "use the app default". */
export type BrandColors = {
  primary?: string | null;
  secondary?: string | null;
  text?: string | null;
  background?: string | null;
};

export type BrandPalette = {
  base: string;
  hover: string;
  pressed: string;
  /** Text that sits ON the brand colour — dark when the brand is light. */
  onBrand: string;
  soft: string;
  softStrong: string;
  badgeForeground: string;
  chart2: string;

  secondary: string;
  onSecondary: string;
  text: string;
  mutedText: string;
  background: string;
};

export function brandPalette(colors: BrandColors): BrandPalette {
  const base = normalizeHexColor(colors.primary, DEFAULT_BRAND_COLOR);
  const secondary = normalizeHexColor(
    colors.secondary,
    DEFAULT_SECONDARY_COLOR,
  );
  const text = normalizeHexColor(colors.text, DEFAULT_TEXT_COLOR);
  const background = normalizeHexColor(
    colors.background,
    DEFAULT_BACKGROUND_COLOR,
  );

  return {
    base,
    hover: shade(base, 0.12),
    pressed: shade(base, 0.24),
    onBrand: bestForeground(base),
    soft: tint(base, 0.92),
    softStrong: tint(base, 0.82),
    badgeForeground: shade(base, 0.42),
    chart2: shade(base, 0.2),

    secondary,
    onSecondary: bestForeground(secondary, text),
    text,
    // Muted text is the body colour faded toward the page, so it stays legible
    // whatever pair the tenant picked rather than being a fixed slate grey.
    mutedText: blend(text, background, 0.45),
    background,
  };
}

/**
 * The CSS custom properties the palette maps onto, as `name: value` pairs.
 *
 * Every value is machine-generated by `toHex`, so the strings are always
 * `#rrggbb` — which is what makes it safe to serialise them into a stylesheet.
 *
 * Only colours the tenant actually SET produce tokens. A tenant who has picked
 * a primary colour and nothing else emits primary tokens alone, and the rest of
 * the app keeps the defaults from globals.css. That keeps this feature purely
 * additive: adding the fields changed nothing for tenants already branded.
 */
export function brandCssVars(colors: BrandColors): Record<string, string> {
  const p = brandPalette(colors);

  const vars: Record<string, string> = {
    "--brand-base": p.base,
    "--brand-hover": p.hover,
    "--brand-pressed": p.pressed,
    "--brand-accent": p.base,
    "--brand-accent-foreground": p.onBrand,
    "--brand-badge": p.soft,
    "--brand-badge-foreground": p.badgeForeground,
    "--brand-soft": p.soft,
    "--brand-ink": p.base,
    "--primary": p.base,
    "--primary-foreground": p.onBrand,
    "--ring": p.base,
    "--accent": p.softStrong,
    "--accent-foreground": p.base,
    "--sidebar-primary": p.base,
    "--sidebar-primary-foreground": p.onBrand,
    "--sidebar-accent": p.softStrong,
    "--sidebar-accent-foreground": p.base,
    "--sidebar-ring": p.base,
    "--chart-1": p.base,
    "--chart-2": p.chart2,
  };

  if (isHexColor(colors.secondary)) {
    vars["--secondary"] = p.secondary;
    vars["--secondary-foreground"] = p.onSecondary;
  }

  if (isHexColor(colors.text)) {
    vars["--foreground"] = p.text;
    vars["--card-foreground"] = p.text;
    vars["--popover-foreground"] = p.text;
    vars["--sidebar-foreground"] = p.text;
    vars["--muted-foreground"] = p.mutedText;
  }

  if (isHexColor(colors.background)) {
    vars["--background"] = p.background;
  }

  return vars;
}
