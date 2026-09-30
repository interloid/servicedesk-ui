import { cn } from "@/lib/utils";

/**
 * Spot illustrations for the portal's onboarding screens.
 *
 * Drawn inline and painted only with the --brand-* custom properties, so they
 * wear the tenant's colours the same way the header and buttons do: a navy
 * brand gets a navy envelope, not our green one. `color-mix` makes the pale
 * tints from the one brand colour instead of adding more tokens.
 */
const BRAND = "var(--brand-accent)";
const TINT = "color-mix(in srgb, var(--brand-accent) 14%, white)";
const WASH = "color-mix(in srgb, var(--brand-accent) 7%, white)";
const MID = "color-mix(in srgb, var(--brand-accent) 55%, white)";
const SPARK = "#f5b93a";

/** A four-point twinkle, the size of a confetti fleck. */
function Sparkle({
  x,
  y,
  size,
  color = SPARK,
}: {
  x: number;
  y: number;
  size: number;
  color?: string;
}) {
  return (
    <path
      d={`M${x} ${y - size} 1.6 ${size * 0.62} ${size * 0.62} 1.6L${x} ${
        y + size
      } -1.6-${size * 0.62}-${size * 0.62}-1.6z`}
      fill={color}
    />
  );
}

export function WelcomeIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 220 150"
      fill="none"
      aria-hidden
      className={cn("h-auto w-44 sm:w-52", className)}
    >
      <ellipse cx="110" cy="86" rx="74" ry="54" fill={WASH} />
      <ellipse cx="110" cy="138" rx="50" ry="5" fill={TINT} />

      {/* Rosette */}
      <path d="m92 104-10 32 14-6 8 12 6-30" fill={MID} />
      <path d="m128 104 10 32-14-6-8 12-6-30" fill={BRAND} />
      <circle cx="110" cy="76" r="38" fill={BRAND} />
      <circle cx="110" cy="76" r="29" fill="white" opacity="0.18" />
      <path
        d="m110 58 5.5 11.2 12.3 1.8-8.9 8.7 2.1 12.3L110 86.2 99 92l2.1-12.3-8.9-8.7 12.3-1.8L110 58Z"
        fill="white"
      />

      {/* Confetti */}
      <rect
        x="42"
        y="40"
        width="10"
        height="4"
        rx="2"
        fill={SPARK}
        transform="rotate(-30 42 40)"
      />
      <rect
        x="170"
        y="36"
        width="10"
        height="4"
        rx="2"
        fill={MID}
        transform="rotate(35 170 36)"
      />
      <rect
        x="182"
        y="92"
        width="8"
        height="4"
        rx="2"
        fill={SPARK}
        transform="rotate(-20 182 92)"
      />
      <rect
        x="30"
        y="98"
        width="8"
        height="4"
        rx="2"
        fill={BRAND}
        transform="rotate(25 30 98)"
      />
      <circle cx="62" cy="26" r="3" fill={BRAND} />
      <circle cx="160" cy="118" r="3" fill={SPARK} />
      <Sparkle x={156} y={22} size={7} />
      <Sparkle x={48} y={72} size={5} color={MID} />
    </svg>
  );
}
