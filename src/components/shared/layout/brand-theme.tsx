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

  const declarations: string[] = [];

  if (brand) {
    declarations.push(
      `--brand-base: ${brand}`,
      `--brand-hover: color-mix(in srgb, ${brand} 85%, black)`,
      `--brand-pressed: color-mix(in srgb, ${brand} 70%, black)`,
      `--brand-badge: color-mix(in srgb, ${brand} 14%, white)`,
      `--brand-badge-foreground: color-mix(in srgb, ${brand} 80%, black)`,
      `--primary: ${brand}`,
      `--primary-foreground: ${readableOn(brand)}`,
      `--ring: ${brand}`,
    );
  }

  if (accent) {
    declarations.push(
      `--brand-accent: ${accent}`,
      `--brand-accent-foreground: ${readableOn(accent)}`,
    );
  }

  if (foreground) {
    declarations.push(`--foreground: ${foreground}`);
  }

  if (page) {
    declarations.push(`--background: ${page}`);
  }

  if (declarations.length === 0) {
    return null;
  }

  // Both selectors, so a brand survives the dark theme's own overrides.
  const css = `:root, .dark, [data-theme="dark"] { ${declarations.join("; ")}; }`;

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
