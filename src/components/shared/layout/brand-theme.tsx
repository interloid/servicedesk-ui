import { brandPalette, isHexColor } from "@/features/branding/branding";

/**
 * Re-points the --brand-* custom properties (see globals.css) at a tenant's
 * own colours, so everything built on them -- bg-brand-accent, text-primary,
 * the primary button -- wears that brand without per-component overrides.
 *
 * Values come from tenant-editable branding, so only plain hex colours are
 * written into the stylesheet; anything else is dropped and the default theme
 * shows through.
 */

/** Stored colours are #rrggbb; older rows may hold #rgb, so expand those. */
function safeHex(value: string | null | undefined): string | null {
  const trimmed = value?.trim();

  if (trimmed && /^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${[...trimmed.slice(1)].map((digit) => digit + digit).join("")}`;
  }

  return trimmed && isHexColor(trimmed) ? trimmed.toLowerCase() : null;
}

export function BrandTheme({
  primary,
  text,
  background,
}: {
  primary?: string | null;
  text?: string | null;
  background?: string | null;
}) {
  const brand = safeHex(primary);
  const foreground = safeHex(text);
  const page = safeHex(background);

  // The same palette the branding preview paints with, so what an admin
  // previews is what customers get.
  const p = brandPalette({
    primary: brand,
    text: foreground,
    background: page,
  });

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
      `--brand-base: ${p.base}`,
      `--brand-accent: ${p.base}`,
      `--brand-accent-foreground: ${p.onBrand}`,
      `--primary: ${p.base}`,
      `--primary-foreground: ${p.onBrand}`,
      `--ring: ${p.base}`,
    );
    light.push(
      `--brand-hover: ${p.hover}`,
      `--brand-pressed: ${p.pressed}`,
      `--brand-badge: ${p.soft}`,
      `--brand-badge-foreground: ${p.badgeForeground}`,
      `--brand-soft: ${p.soft}`,
      `--brand-ink: ${p.base}`,
      // The hover/highlight wash of menus, selects, the command list and
      // outline buttons. Left alone it stays our teal on every brand.
      `--accent: ${p.soft}`,
      `--accent-foreground: ${p.badgeForeground}`,
      `--sidebar-accent: ${p.soft}`,
      `--sidebar-accent-foreground: ${p.badgeForeground}`,
    );
    // The dark theme's own badge tokens already sit on --accent, which reads on
    // a dark page; only the interaction shades need the brand.
    dark.push(
      `--brand-hover: color-mix(in srgb, ${p.base} 85%, white)`,
      `--brand-pressed: ${p.base}`,
    );
  }

  if (foreground) {
    light.push(
      `--foreground: ${p.text}`,
      `--card-foreground: ${p.text}`,
      `--popover-foreground: ${p.text}`,
      `--muted-foreground: ${p.mutedText}`,
    );
  }

  if (page) {
    light.push(`--background: ${p.background}`);
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
