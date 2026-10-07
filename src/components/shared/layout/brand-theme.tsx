/**
 * Re-points the --brand-* custom properties (see globals.css) at a tenant's
 * own colours, so everything built on them -- bg-brand-accent, text-primary,
 * the primary button -- wears that brand without per-component overrides.
 *
 * Values come from tenant-editable branding, so only plain hex colours are
 * written into the stylesheet; anything else is dropped and the default theme
 * shows through.
 */

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function safeHex(value: string | null | undefined): string | null {
  const trimmed = value?.trim();

  return trimmed && HEX_COLOR.test(trimmed) ? trimmed : null;
}

function toRgb(hex: string): [number, number, number] {
  const digits =
    hex.length === 4
      ? hex
          .slice(1)
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : hex.slice(1);

  return [0, 2, 4].map((offset) =>
    parseInt(digits.slice(offset, offset + 2), 16),
  ) as [number, number, number];
}

/** WCAG relative luminance: pick whichever of black or white reads better. */
function readableOn(hex: string): string {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const c = channel / 255;

    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  return luminance > 0.179 ? "#0f172a" : "#ffffff";
}

export function BrandTheme({
  primary,
  secondary,
  text,
  background,
}: {
  primary?: string | null;
  secondary?: string | null;
  text?: string | null;
  background?: string | null;
}) {
  const brand = safeHex(primary);
  const accent = safeHex(secondary) ?? brand;
  const foreground = safeHex(text);
  const page = safeHex(background);

  // Three blocks, because a brand colour does not mean the same thing in both
  // themes:
  // - shared: the brand itself, which is the brand whatever the theme;
  // - light only: page text and background, and hover/pressed/badge shades
  //   mixed toward black and white for a light page;
  // - dark only: hover lightened rather than darkened, so the brand mark keeps
  //   its contrast against a dark page.
  // A tenant's text and background colours are chosen for a light page. Written
  // into dark mode too, a dark text colour would land on a dark background.
  const shared: string[] = [];
  const light: string[] = [];
  const dark: string[] = [];

  if (brand) {
    shared.push(
      `--brand-base: ${brand}`,
      `--primary: ${brand}`,
      `--primary-foreground: ${readableOn(brand)}`,
      `--ring: ${brand}`,
    );
    light.push(
      `--brand-hover: color-mix(in srgb, ${brand} 85%, black)`,
      `--brand-pressed: color-mix(in srgb, ${brand} 70%, black)`,
      `--brand-badge: color-mix(in srgb, ${brand} 14%, white)`,
      `--brand-badge-foreground: color-mix(in srgb, ${brand} 80%, black)`,
    );
    // The dark theme's own badge tokens already sit on --accent, which reads on
    // a dark page; only the interaction shades need the brand.
    dark.push(
      `--brand-hover: color-mix(in srgb, ${brand} 85%, white)`,
      `--brand-pressed: ${brand}`,
    );
  }

  if (accent) {
    shared.push(
      `--brand-accent: ${accent}`,
      `--brand-accent-foreground: ${readableOn(accent)}`,
    );
  }

  if (foreground) {
    light.push(`--foreground: ${foreground}`);
  }

  if (page) {
    light.push(`--background: ${page}`);
  }

  const rule = (selector: string, declarations: string[]) =>
    declarations.length > 0
      ? `${selector} { ${declarations.join("; ")}; }`
      : "";

  const css = [
    // Both theme selectors, so the brand survives the dark theme's own
    // overrides in globals.css.
    rule(`:root, .dark, [data-theme="dark"]`, shared),
    rule(`:root:not(.dark):not([data-theme="dark"])`, light),
    rule(`.dark, [data-theme="dark"]`, dark),
  ]
    .filter(Boolean)
    .join("\n");

  if (!css) {
    return null;
  }

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
