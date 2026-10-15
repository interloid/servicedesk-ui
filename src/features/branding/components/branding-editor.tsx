"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Eye,
  FileText,
  Loader2,
  Menu,
  Monitor,
  Plus,
  Search,
  Smartphone,
  Tablet,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createSupabaseClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import type {
  BrandPalette,
  SlugAvailability,
  TenantBranding,
} from "@/features/branding/branding";
import {
  brandPalette,
  contrastRatio,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BRAND_COLOR,
  DEFAULT_SECONDARY_COLOR,
  DEFAULT_TEXT_COLOR,
  isHexColor,
  LOGO_BUCKET,
  LOGO_MIME_TYPES,
  MAX_LOGO_BYTES,
  MAX_NAME_LENGTH,
  MAX_SLUG_LENGTH,
  MIN_READABLE_CONTRAST,
} from "@/features/branding/branding";
import {
  checkSlugAvailabilityAction,
  prepareLogoUploadAction,
  updateBrandingAction,
} from "@/features/branding/branding-actions";
import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";
import {
  TEAM_DIALOG_CONTENT,
  TEAM_DIALOG_FOOTER,
  TEAM_DIALOG_TITLE,
  TEAM_MODAL_BUTTON,
  TEAM_MODAL_BUTTON_DANGER,
} from "@/features/team/components/modal-buttons";

const FIELD_CLASS = "h-11 rounded-sm text-sm md:h-10.5";

// Page-level actions, the same metrics as the SLA policy editor's header.
const PAGE_BUTTON =
  "h-10 gap-2 rounded-lg px-4 text-sm font-semibold shadow-none";
const PAGE_BUTTON_PRIMARY = `${PAGE_BUTTON} bg-brand-accent text-brand-accent-foreground hover:bg-brand-accent/90`;
const PAGE_BUTTON_OUTLINE = `${PAGE_BUTTON} bg-white`;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Quick picks for the brand colour; anything else goes through "+" or hex. */
const PRESET_COLORS = [
  "#0f766e",
  "#2563eb",
  "#9333ea",
  "#ec4899",
  "#f97316",
  "#fbbf24",
  "#94a3b8",
];

type FieldErrors = {
  name?: string;
  slug?: string;
  color?: string;
  secondaryColor?: string;
  textColor?: string;
  backgroundColor?: string;
  email?: string;
  logoUrl?: string;
};

type PreviewDevice = "desktop" | "tablet" | "mobile";

type SlugCheck = { slug: string; status: SlugAvailability | "error" };

function normalizeHex(value: string): string {
  const trimmed = value.trim();
  if (/^[0-9a-f]{6}$/i.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  return trimmed;
}

function splitOrigin(origin: string): { protocol: string; host: string } {
  const match = /^(https?:\/\/)(.*)$/.exec(origin);
  return match
    ? { protocol: match[1], host: match[2] }
    : { protocol: "", host: origin };
}

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 1)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

export function BrandingEditor({
  branding,
  canEdit,
  portalOrigin,
}: {
  branding: TenantBranding;
  canEdit: boolean;
  /** Where this app is served, e.g. https://servicedesk-ui.vercel.app. */
  portalOrigin: string;
}) {
  const [draft, setDraft] = useState<TenantBranding>(branding);
  const [saved, setSaved] = useState<TenantBranding>(branding);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [slugCheck, setSlugCheck] = useState<SlugCheck | null>(null);
  const [confirm, setConfirm] = useState<"discard" | "remove-logo" | null>(
    null,
  );

  const color = draft.primaryColor || DEFAULT_BRAND_COLOR;
  const previewColor = HEX_COLOR.test(color) ? color : DEFAULT_BRAND_COLOR;

  // The same function the running app paints with, so the preview cannot drift
  // from it. Notably `onBrand`: on a light brand colour the app puts dark text
  // on the button, and the preview used to hard-code white — which previewed as
  // unreadable and then shipped as something else.
  const palette = brandPalette({
    primary: previewColor,
    secondary: draft.secondaryColor,
    text: draft.textColor,
    background: draft.backgroundColor,
  });

  // Warned about, not blocked. Which colours a brand uses is the tenant's call;
  // shipping text nobody can read without mentioning it is not.
  const textOnBackground = contrastRatio(palette.text, palette.background);
  const lowContrast = textOnBackground < MIN_READABLE_CONTRAST;
  const onBrandContrast = contrastRatio(palette.onBrand, palette.base);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const slug = draft.slug.trim();

  // The portal is path-based: /{slug}/portal/login on this app's own origin.
  const { protocol, host: portalHost } = splitOrigin(portalOrigin);
  const portalLoginUrl = `${portalOrigin}${portalPath(slug || "…", PORTAL_ROUTES.LOGIN)}`;

  // Advisory availability, debounced so typing doesn't fire a request per key.
  // The unique constraint still has the final word when the form is saved.
  useEffect(() => {
    if (!canEdit || !slug || !SLUG_PATTERN.test(slug)) return;
    if (slug === saved.slug) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await checkSlugAvailabilityAction(slug);
      if (cancelled) return;
      setSlugCheck({
        slug,
        status: result.ok && result.data ? result.data : "error",
      });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, saved.slug, canEdit]);

  const slugStatus: SlugAvailability | "error" | "checking" | null = !slug
    ? null
    : slug === saved.slug
      ? "current"
      : !SLUG_PATTERN.test(slug)
        ? "invalid"
        : slugCheck?.slug === slug
          ? slugCheck.status
          : "checking";

  const set = (patch: Partial<TenantBranding>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  const validate = (): boolean => {
    const next: FieldErrors = {};

    if (draft.name.trim().length === 0) {
      next.name = "Give your workspace a name.";
    }

    if (slug.length === 0) {
      next.slug = "Enter a portal address.";
    } else if (!SLUG_PATTERN.test(slug)) {
      next.slug = "Use lowercase letters, numbers and hyphens only.";
    } else if (slugStatus === "taken") {
      next.slug = "That portal address is taken. Try another.";
    } else if (slugStatus === "invalid") {
      next.slug = "That address is reserved. Try another.";
    }

    if (!HEX_COLOR.test(color)) {
      next.color = "Enter a hex color like #0F766E.";
    }

    // Blank is allowed and meaningful for these three — it clears the override.
    if (draft.secondaryColor?.trim() && !isHexColor(draft.secondaryColor)) {
      next.secondaryColor = "Enter a hex color like #F1F5F9.";
    }

    if (draft.textColor?.trim() && !isHexColor(draft.textColor)) {
      next.textColor = "Enter a hex color like #0F172A.";
    }

    if (draft.backgroundColor?.trim() && !isHexColor(draft.backgroundColor)) {
      next.backgroundColor = "Enter a hex color like #F8FAFC.";
    }

    if (
      draft.supportEmail?.trim() &&
      !/^\S+@\S+\.\S+$/.test(draft.supportEmail.trim())
    ) {
      next.email = "Enter a valid support email.";
    }

    if (
      draft.logoUrl?.trim() &&
      !/^https?:\/\/\S+$/.test(draft.logoUrl.trim())
    ) {
      next.logoUrl = "Use a full URL starting with http(s).";
    }

    setErrors(next);

    // The extra settings are collapsed by default; open them so the message
    // is actually visible.
    if (
      next.secondaryColor ||
      next.textColor ||
      next.backgroundColor ||
      next.email
    ) {
      setMoreOpen(true);
    }

    return Object.keys(next).length === 0;
  };

  const save = () => {
    if (!validate()) return;

    startTransition(async () => {
      const result = await updateBrandingAction({
        name: draft.name,
        slug: draft.slug,
        primaryColor: normalizeHex(color),
        secondaryColor: normalizeHex(draft.secondaryColor ?? ""),
        textColor: normalizeHex(draft.textColor ?? ""),
        backgroundColor: normalizeHex(draft.backgroundColor ?? ""),
        supportEmail: draft.supportEmail ?? "",
        logoUrl: draft.logoUrl ?? "",
        showLogoOnPortal: draft.showLogoOnPortal,
      });

      if (!result.ok) {
        toast.error(result.message ?? "We couldn't save your branding.");
        return;
      }

      if (result.data) {
        setDraft(result.data);
        setSaved(result.data);
      }

      toast.success("Branding saved.");
    });
  };

  const discard = () => {
    setDraft(saved);
    setErrors({});
  };

  const uploadLogo = async (file: File) => {
    if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
      toast.error("Use a PNG, JPG or WebP image.");
      return;
    }

    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Logos can be up to 2 MB.");
      return;
    }

    setUploading(true);

    try {
      const prepared = await prepareLogoUploadAction({
        size: file.size,
        type: file.type,
      });

      if (!prepared.ok || !prepared.data) {
        toast.error(prepared.message ?? "We couldn't upload that logo.");
        return;
      }

      const { error } = await createSupabaseClient()
        .storage.from(LOGO_BUCKET)
        .uploadToSignedUrl(prepared.data.path, prepared.data.token, file, {
          contentType: file.type,
        });

      if (error) {
        toast.error("We couldn't upload that logo. Try again.");
        return;
      }

      set({ logoUrl: prepared.data.publicUrl });
      setErrors((prev) => ({ ...prev, logoUrl: undefined }));
      toast.success("Logo uploaded. Save changes to publish it.");
    } finally {
      setUploading(false);
    }
  };

  const logoUrl = draft.logoUrl?.trim() || null;
  const displayName = draft.name.trim() || "Your workspace";
  const initials = initialsOf(draft.name);

  return (
    <div className="h-full overflow-y-auto p-4 font-sans text-slate-900 sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">Branding</h1>
            <p className="text-sm text-muted-foreground">
              Customize how your customers see your support portal.
            </p>
          </div>

          {canEdit && (
            <div className="flex w-full flex-wrap items-center gap-3 *:flex-1 sm:w-auto sm:*:flex-none">
              <Button
                variant="outline"
                disabled={pending || !dirty}
                onClick={() => setConfirm("discard")}
                className={PAGE_BUTTON_OUTLINE}
              >
                Discard changes
              </Button>
              <Button
                onClick={save}
                disabled={pending || uploading || !dirty}
                className={PAGE_BUTTON_PRIMARY}
              >
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          {/* ---------------------------------------------------------------- */}
          {/* Settings                                                         */}
          {/* ---------------------------------------------------------------- */}
          <div className="@container flex min-w-0 flex-col rounded-[14px] border border-border bg-card p-4 sm:p-5">
            {!canEdit && (
              <p className="mb-4 rounded-sm bg-muted px-3 py-2.5 text-sm text-muted-foreground">
                Only a Tenant Admin can change branding.
              </p>
            )}

            <Section
              title="Logo"
              description="This logo will appear in the portal header and on customer pages."
            >
              <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
                <div className="flex items-center gap-3 rounded-[12px] border border-border p-3.5">
                  <BrandMark
                    logoUrl={logoUrl}
                    initials={initials}
                    palette={palette}
                    className="size-14 rounded-[10px] text-xl"
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-xs text-muted-foreground">
                      Current logo
                    </span>
                    <span className="truncate text-sm font-semibold">
                      {displayName}
                    </span>
                  </div>
                  {canEdit && logoUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-8 rounded-lg px-3 text-xs font-semibold shadow-none ${TEAM_MODAL_BUTTON_DANGER}`}
                      onClick={() => setConfirm("remove-logo")}
                      disabled={pending || uploading}
                    >
                      Remove
                    </Button>
                  )}
                </div>

                <LogoDropzone
                  disabled={!canEdit || pending}
                  uploading={uploading}
                  onFile={uploadLogo}
                />
              </div>
              {errors.logoUrl && (
                <p className="text-sm text-destructive-strong">
                  {errors.logoUrl}
                </p>
              )}

              <div className="flex items-center justify-between gap-4 rounded-[12px] border border-border px-3.5 py-3">
                <div className="flex flex-col gap-0.5">
                  <Label
                    htmlFor="branding-logo-on-portal"
                    className="font-semibold text-foreground"
                  >
                    Show logo on customer portal
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    When off, the portal header shows only your name.
                  </p>
                </div>
                <Switch
                  id="branding-logo-on-portal"
                  checked={draft.showLogoOnPortal}
                  onCheckedChange={(v) => set({ showLogoOnPortal: v })}
                  disabled={!canEdit}
                />
              </div>
            </Section>

            <Section
              title="Display name"
              description="This name appears in your portal header and to your customers."
              htmlFor="branding-name"
            >
              <div className="relative">
                <Input
                  id="branding-name"
                  className={cn(FIELD_CLASS, "pr-20")}
                  value={draft.name}
                  maxLength={MAX_NAME_LENGTH}
                  onChange={(e) => set({ name: e.target.value })}
                  disabled={!canEdit}
                  aria-invalid={Boolean(errors.name)}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground tabular-nums">
                  {draft.name.length}/{MAX_NAME_LENGTH}
                </span>
              </div>
              {errors.name && (
                <p className="text-sm text-destructive-strong">{errors.name}</p>
              )}
            </Section>

            <Section
              title="Portal address"
              description="Choose a short, easy-to-remember address for your support portal."
              htmlFor="branding-slug"
            >
              <div
                className={cn(
                  "flex h-11 items-stretch overflow-hidden rounded-sm border border-input text-sm md:h-10.5",
                  "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
                  errors.slug && "border-destructive",
                  !canEdit && "opacity-50",
                )}
              >
                <span
                  className="flex max-w-[45%] min-w-0 flex-none items-center border-r border-input bg-muted px-3 text-muted-foreground"
                  title={`${portalOrigin}/`}
                >
                  <span className="truncate">
                    <span className="hidden sm:inline">{protocol}</span>
                    {portalHost}/
                  </span>
                </span>
                <input
                  id="branding-slug"
                  type="text"
                  className="min-w-0 flex-1 bg-transparent px-3 outline-none disabled:cursor-not-allowed"
                  value={draft.slug}
                  maxLength={MAX_SLUG_LENGTH}
                  onChange={(e) =>
                    set({
                      slug: e.target.value
                        .trim()
                        .toLowerCase()
                        .replace(/\s+/g, "-"),
                    })
                  }
                  disabled={!canEdit}
                  aria-invalid={Boolean(errors.slug)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className="flex flex-none items-center border-l border-input bg-muted px-3 text-muted-foreground">
                  {PORTAL_ROUTES.ROOT}
                </span>
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  {errors.slug ? (
                    <p className="text-sm text-destructive-strong">
                      {errors.slug}
                    </p>
                  ) : (
                    <SlugStatus status={slugStatus} url={portalLoginUrl} />
                  )}
                  <p className="text-sm text-muted-foreground">
                    Use lowercase letters, numbers or hyphens.
                  </p>
                </div>
                <span className="flex-none pt-0.5 text-xs text-muted-foreground tabular-nums">
                  {draft.slug.length}/{MAX_SLUG_LENGTH}
                </span>
              </div>
            </Section>

            <Section
              title="Brand colour"
              description="This colour will be used for the portal header, buttons, links and other accents."
            >
              <div className="flex flex-wrap items-center gap-2.5">
                {PRESET_COLORS.map((preset) => {
                  const selected = previewColor.toLowerCase() === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      className={cn(
                        "flex size-10 items-center justify-center rounded-full transition-transform @sm:size-11 hover:scale-105 disabled:pointer-events-none disabled:opacity-50",
                        selected && "ring-2 ring-offset-2 ring-offset-card",
                      )}
                      style={{
                        backgroundColor: preset,
                        ...(selected
                          ? ({
                              "--tw-ring-color": preset,
                            } as React.CSSProperties)
                          : null),
                      }}
                      onClick={() => {
                        set({ primaryColor: preset });
                        setErrors((prev) => ({ ...prev, color: undefined }));
                      }}
                      disabled={!canEdit}
                      aria-label={`Use ${preset}`}
                      aria-pressed={selected}
                    >
                      {selected && (
                        <Check
                          className="size-5"
                          style={{ color: palette.onBrand }}
                          strokeWidth={3}
                        />
                      )}
                    </button>
                  );
                })}

                <label
                  className={cn(
                    "relative flex size-10 cursor-pointer items-center justify-center rounded-full border @sm:size-11 border-border bg-card text-foreground transition-colors hover:bg-muted",
                    !PRESET_COLORS.includes(previewColor.toLowerCase()) &&
                      "ring-2 ring-offset-2 ring-offset-card",
                    !canEdit && "pointer-events-none opacity-50",
                  )}
                  style={
                    !PRESET_COLORS.includes(previewColor.toLowerCase())
                      ? ({
                          "--tw-ring-color": previewColor,
                        } as React.CSSProperties)
                      : undefined
                  }
                  aria-label="Pick a custom colour"
                >
                  <Plus className="size-5" />
                  <input
                    type="color"
                    className="sr-only"
                    value={palette.base}
                    onChange={(e) => set({ primaryColor: e.target.value })}
                    disabled={!canEdit}
                  />
                </label>

                <Input
                  id="branding-color"
                  type="text"
                  className={cn(
                    FIELD_CLASS,
                    "w-full font-mono uppercase @sm:w-32",
                  )}
                  placeholder={DEFAULT_BRAND_COLOR}
                  value={draft.primaryColor ?? ""}
                  onChange={(e) => set({ primaryColor: e.target.value })}
                  disabled={!canEdit}
                  aria-label="Brand colour hex"
                  aria-invalid={Boolean(errors.color)}
                />
              </div>

              {errors.color ? (
                <p className="text-sm text-destructive-strong">
                  {errors.color}
                </p>
              ) : (
                <Notice
                  tone={
                    onBrandContrast >= MIN_READABLE_CONTRAST ? "ok" : "warn"
                  }
                >
                  {onBrandContrast >= MIN_READABLE_CONTRAST
                    ? "Text colour will be set automatically for better readability."
                    : `Text on this colour reaches ${onBrandContrast.toFixed(1)}:1 — below ${MIN_READABLE_CONTRAST}:1 it can be hard to read. You can still save it.`}
                </Notice>
              )}
            </Section>

            <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 border-t border-border pt-4 text-left">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">
                    More options
                  </span>
                  <span className="text-sm text-muted-foreground">
                    Page colours and support email.
                  </span>
                </div>
                <ChevronDown
                  className={cn(
                    "size-4 flex-none text-muted-foreground transition-transform",
                    moreOpen && "rotate-180",
                  )}
                />
              </CollapsibleTrigger>

              <CollapsibleContent className="flex flex-col gap-4 pt-4">
                <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
                  <ColorField
                    id="branding-secondary-color"
                    label="Secondary colour"
                    hint="Quiet buttons and muted surfaces. Blank uses the default."
                    swatch={palette.secondary}
                    value={draft.secondaryColor ?? ""}
                    placeholder={DEFAULT_SECONDARY_COLOR}
                    error={errors.secondaryColor}
                    disabled={!canEdit}
                    onChange={(secondaryColor) => set({ secondaryColor })}
                  />

                  <ColorField
                    id="branding-text-color"
                    label="Text colour"
                    hint="Body text across the app. Blank uses the default."
                    swatch={palette.text}
                    value={draft.textColor ?? ""}
                    placeholder={DEFAULT_TEXT_COLOR}
                    error={errors.textColor}
                    disabled={!canEdit}
                    onChange={(textColor) => set({ textColor })}
                  />

                  <ColorField
                    id="branding-background-color"
                    label="Background colour"
                    hint="The page behind your cards. Blank uses the default."
                    swatch={palette.background}
                    value={draft.backgroundColor ?? ""}
                    placeholder={DEFAULT_BACKGROUND_COLOR}
                    error={errors.backgroundColor}
                    disabled={!canEdit}
                    onChange={(backgroundColor) => set({ backgroundColor })}
                  />

                  <Field
                    id="branding-support-email"
                    label="Support email"
                    hint="Where customer replies go."
                    error={errors.email}
                    control={
                      <Input
                        id="branding-support-email"
                        type="email"
                        className={FIELD_CLASS}
                        placeholder="support@northwind.io"
                        value={draft.supportEmail ?? ""}
                        onChange={(e) => set({ supportEmail: e.target.value })}
                        disabled={!canEdit}
                        aria-invalid={Boolean(errors.email)}
                      />
                    }
                  />
                </div>

                {lowContrast && (
                  <Notice tone="warn">
                    Your text and background sit at{" "}
                    {textOnBackground.toFixed(1)}:1. Below{" "}
                    {MIN_READABLE_CONTRAST}:1 body text is hard to read. You can
                    still save this.
                  </Notice>
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* Live preview                                                     */}
          {/* ---------------------------------------------------------------- */}
          <div className="flex min-w-0 flex-col gap-4 rounded-[14px] border border-border bg-card p-4 sm:p-5 xl:sticky xl:top-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex size-11 flex-none items-center justify-center rounded-[10px] bg-brand-soft text-brand-ink">
                  <Eye className="size-5" />
                </span>
                <div className="flex flex-col gap-0.5">
                  <h2 className="text-lg font-semibold tracking-tight">
                    Live portal preview
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    See how your branding will look to your customers.
                  </p>
                </div>
              </div>

              <div
                className="flex w-full items-center gap-1 rounded-[10px] border border-border p-1 *:flex-1 sm:w-auto sm:*:flex-none"
                role="tablist"
                aria-label="Preview size"
              >
                <DeviceTab
                  active={device === "desktop"}
                  onClick={() => setDevice("desktop")}
                  icon={<Monitor className="size-4" />}
                  label="Desktop"
                />
                <DeviceTab
                  active={device === "tablet"}
                  onClick={() => setDevice("tablet")}
                  icon={<Tablet className="size-4" />}
                  label="Tablet"
                />
                <DeviceTab
                  active={device === "mobile"}
                  onClick={() => setDevice("mobile")}
                  icon={<Smartphone className="size-4" />}
                  label="Mobile"
                />
              </div>
            </div>

            <PortalPreview
              palette={palette}
              name={displayName}
              showLogo={draft.showLogoOnPortal}
              logoUrl={logoUrl}
              initials={initials}
              device={device}
            />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "discard"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Discard changes"
        description="Your unsaved branding changes will be lost and the page will go back to what's currently live."
        confirmLabel="Discard changes"
        onConfirm={() => {
          discard();
          setConfirm(null);
        }}
      />

      <ConfirmDialog
        open={confirm === "remove-logo"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Remove logo"
        description="Your portal will show your initial in the brand colour instead. The change goes live when you save."
        confirmLabel="Remove logo"
        onConfirm={() => {
          set({ logoUrl: null });
          setConfirm(null);
        }}
      />
    </div>
  );
}

/** Same confirm popup as the Team & roles screen: metrics from its token file. */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`gap-3 sm:max-w-115 ${TEAM_DIALOG_CONTENT}`}>
        <DialogHeader className="pr-6">
          <DialogTitle className={TEAM_DIALOG_TITLE}>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DialogFooter className={TEAM_DIALOG_FOOTER}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className={TEAM_MODAL_BUTTON}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onConfirm}
            className={`${TEAM_MODAL_BUTTON} ${TEAM_MODAL_BUTTON_DANGER}`}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Settings pieces
// ---------------------------------------------------------------------------

function Section({
  title,
  description,
  htmlFor,
  children,
}: {
  title: string;
  description: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-b border-border pb-5 not-first:pt-5">
      <div className="flex flex-col gap-0.5">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="text-[15px] font-semibold">
            {title}
          </Label>
        ) : (
          <h2 className="text-[15px] font-semibold">{title}</h2>
        )}
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "ok" | "warn";
  children: React.ReactNode;
}) {
  const Icon = tone === "ok" ? Check : CircleAlert;

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[10px] px-3.5 py-3 text-sm",
        tone === "ok"
          ? "bg-brand-soft text-brand-ink"
          : "border border-warning/40 bg-warning-soft text-warning-strong",
      )}
    >
      <span
        className={cn(
          "mt-px flex size-5 flex-none items-center justify-center rounded-full",
          tone === "ok"
            ? "bg-brand-accent text-brand-accent-foreground"
            : "text-warning-strong",
        )}
      >
        <Icon className={tone === "ok" ? "size-3" : "size-4"} strokeWidth={3} />
      </span>
      <span>{children}</span>
    </div>
  );
}

function SlugStatus({
  status,
  url,
}: {
  status: SlugAvailability | "error" | "checking" | null;
  /** The customer sign-in link this address would give. */
  url: string;
}) {
  if (!status) return null;

  // The link is long and unbreakable, so it wraps anywhere (break-all) rather
  // than pushing the card wider than a phone screen.
  const link = <span className="break-all">{url}</span>;

  if (status === "checking") {
    return (
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Loader2 className="mt-0.5 size-4 flex-none animate-spin" />
        <span className="min-w-0">Checking {link}…</span>
      </p>
    );
  }

  if (status === "available" || status === "current") {
    return (
      <p className="flex items-start gap-2 text-sm font-medium text-success-strong">
        <span className="mt-px flex size-5 flex-none items-center justify-center rounded-full bg-success text-white">
          <Check className="size-3" strokeWidth={3} />
        </span>
        <span className="min-w-0">
          {link}{" "}
          {status === "current" ? "is your current address" : "is available"}
        </span>
      </p>
    );
  }

  return (
    <p className="flex items-start gap-2 text-sm font-medium text-destructive-strong">
      <CircleAlert className="mt-0.5 size-4 flex-none" />
      <span className="min-w-0">
        {status === "taken" ? (
          <>{link} is already taken</>
        ) : status === "invalid" ? (
          "That address is reserved or not allowed"
        ) : (
          "Couldn't check this address right now"
        )}
      </span>
    </p>
  );
}

function LogoDropzone({
  disabled,
  uploading,
  onFile,
}: {
  disabled: boolean;
  uploading: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const inactive = disabled || uploading;

  return (
    <button
      type="button"
      className={cn(
        "flex min-h-22 flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-border bg-muted/40 p-3.5 text-center transition-colors",
        "hover:border-brand-base/50 hover:bg-brand-soft/60 disabled:pointer-events-none disabled:opacity-60",
        over && "border-brand-base bg-brand-soft",
      )}
      disabled={inactive}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file && !inactive) onFile(file);
      }}
    >
      {uploading ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : (
        <Upload className="size-5 text-foreground" />
      )}
      <span className="text-sm font-medium">
        {uploading ? "Uploading…" : "Upload new logo"}
      </span>
      <span className="text-xs text-muted-foreground">
        PNG, JPG or WebP (max 2 MB)
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={LOGO_MIME_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </button>
  );
}

function BrandMark({
  logoUrl,
  initials,
  palette,
  className,
}: {
  logoUrl: string | null;
  initials: string;
  palette: BrandPalette;
  className?: string;
}) {
  return (
    <Avatar className={cn("flex-none", className)}>
      <AvatarImage
        src={logoUrl ?? undefined}
        alt=""
        className="object-contain"
      />
      <AvatarFallback
        className={cn("font-bold", className)}
        style={{ backgroundColor: palette.base, color: palette.onBrand }}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * A swatch that opens the native picker, plus the hex as text.
 *
 * The two stay in step because both write the same draft field. `swatch` is the
 * resolved colour from the palette rather than the raw input, so a half-typed
 * "#0f7" shows the colour that would actually apply instead of going black.
 */
function ColorField({
  id,
  label,
  hint,
  swatch,
  value,
  placeholder,
  error,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  swatch: string;
  value: string;
  placeholder: string;
  error?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      control={
        <div className="flex items-center gap-2.5">
          <label
            htmlFor={`${id}-picker`}
            className="relative inline-flex size-11 flex-none cursor-pointer overflow-hidden rounded-sm border border-border md:size-10.5"
            style={{ backgroundColor: swatch }}
            aria-label={`Pick ${label.toLowerCase()}`}
          >
            <input
              id={`${id}-picker`}
              type="color"
              className="sr-only"
              value={swatch}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
            />
          </label>

          <Input
            id={id}
            type="text"
            className={`${FIELD_CLASS} font-mono uppercase`}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            aria-invalid={Boolean(error)}
          />
        </div>
      }
    />
  );
}

function Field({
  id,
  label,
  control,
  hint,
  error,
}: {
  id: string;
  label: string;
  control: React.ReactNode;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="font-semibold text-foreground">
        {label}
      </Label>
      {control}
      {error ? (
        <p className="text-sm text-destructive-strong">{error}</p>
      ) : hint ? (
        <p className="text-sm text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

function DeviceTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-[8px] px-2 py-1.5 text-sm font-medium whitespace-nowrap transition-colors sm:gap-2 sm:px-3",
        active
          ? "bg-brand-soft text-brand-ink"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

type SampleState = "open" | "waiting_on_you" | "resolved";

// Labels and colours copied from the portal's requests list (STATE_BADGE).
const SAMPLE_BADGE: Record<SampleState, { label: string; className: string }> =
  {
    open: { label: "Open", className: "bg-sky-50 text-sky-700" },
    waiting_on_you: {
      label: "Waiting on you",
      className: "bg-amber-50 text-amber-700",
    },
    resolved: {
      label: "Resolved",
      className: "bg-emerald-50 text-emerald-700",
    },
  };

const SAMPLE_REQUESTS: {
  number: number;
  subject: string;
  preview: string;
  timestamp: string;
  state: SampleState;
}[] = [
  {
    number: 1234,
    subject: "Login not working",
    preview:
      "I'm unable to login to my account. Please help me with this issue.",
    timestamp: "Opened today, 11:22 · Updated 9 min ago",
    state: "open",
  },
  {
    number: 1233,
    subject: "Unable to upload files",
    preview: "File upload shows an error. Need assistance.",
    timestamp: "Opened today, 10:15 · Updated 1 hour ago",
    state: "waiting_on_you",
  },
  {
    number: 1232,
    subject: "Feature request",
    preview: "Can you add dark mode to the portal?",
    timestamp: "Opened 12 Oct 2026 · Resolved 2 hours ago",
    state: "resolved",
  },
];

/**
 * A static copy of the customer portal's requests page (PortalShell header +
 * PortalRequestsList), painted with inline colours from the palette rather than
 * BrandTheme: BrandTheme rewrites the page-wide custom properties, which would
 * rebrand this settings screen too.
 *
 * The portal's own `sm`/`md` breakpoints never fire in here — the preview is a
 * box inside a wide page — so the same switches are made on the preview's own
 * width with one container query, `@lg` (512px): at a real tablet width
 * (768px) the portal already shows Help centre, the account name, side-by-side
 * filters and card icons, so Tablet and Desktop share that layout. Mobile forces
 * the phone layout whatever the width; on a phone the other two fall back to it
 * on their own because the box is narrow.
 */
function PortalPreview({
  palette,
  name,
  showLogo,
  logoUrl,
  initials,
  device,
}: {
  palette: BrandPalette;
  name: string;
  /** Off hides the mark entirely: no logo and no initial tile, just the name. */
  showLogo: boolean;
  logoUrl: string | null;
  initials: string;
  device: PreviewDevice;
}) {
  const wide = device !== "mobile";
  const border = "rgba(15, 23, 42, 0.1)";
  const tint = (percent: number) =>
    `color-mix(in srgb, currentColor ${percent}%, transparent)`;
  // Same casing rule the portal header applies to the tenant name.
  const headerName = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  const muted = { color: palette.mutedText };

  return (
    <div
      className={cn(
        "@container mx-auto w-full min-w-0 overflow-hidden border transition-[max-width] duration-300",
        device === "mobile" &&
          "max-w-90 rounded-[28px] border-[6px] border-slate-900 shadow-lg",
        device === "tablet" &&
          "max-w-3xl rounded-[22px] border-8 border-slate-900 shadow-lg",
        device === "desktop" && "max-w-full rounded-[12px] border-border",
      )}
      aria-hidden
    >
      {device === "desktop" && (
        <div className="flex items-center gap-1.5 border-b border-border bg-muted px-3 py-2.5">
          <span className="size-2.5 rounded-full bg-slate-300" />
          <span className="size-2.5 rounded-full bg-slate-300" />
          <span className="size-2.5 rounded-full bg-slate-300" />
        </div>
      )}

      {/* Header */}
      <div
        className={cn(
          "flex h-15 items-center justify-between gap-3 border-b px-4",
          wide && "@lg:h-16 @lg:px-6",
        )}
        style={{
          backgroundColor: palette.base,
          color: palette.onBrand,
          borderColor: tint(15),
        }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {!showLogo ? null : logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt=""
              className="size-8 shrink-0 rounded-md object-cover"
            />
          ) : (
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-extrabold"
              style={{ backgroundColor: tint(15) }}
            >
              {initials}
            </span>
          )}
          <span className="min-w-0 truncate text-base font-bold tracking-tight">
            {headerName}
            <span className="font-semibold opacity-80"> Support</span>
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className={cn("flex rounded-lg p-2", wide && "@lg:hidden")}>
            <Menu className="size-5" />
          </span>
          {wide && (
            <>
              <span
                className="hidden rounded-lg px-3.5 py-2 text-sm font-semibold @lg:inline-flex"
                style={{ backgroundColor: tint(12) }}
              >
                Help centre
              </span>
              <span className="hidden items-center gap-2 px-1.5 py-1 text-sm font-semibold @lg:flex">
                <span className="flex size-8 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                  J
                </span>
                Jordan Customer
                <ChevronDown className="size-4 opacity-80" />
              </span>
            </>
          )}
        </div>
      </div>

      {/* Requests page */}
      <div
        className={cn("px-4 py-8", wide && "@lg:px-8")}
        style={{ backgroundColor: palette.background, color: palette.text }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h3 className="text-2xl font-bold tracking-tight">Your requests</h3>
            <p className="max-w-md text-sm leading-[1.6]" style={muted}>
              Track and manage everything you&apos;ve raised with{" "}
              {name.toLowerCase()}, and reply without leaving this page.
            </p>
          </div>

          <span
            className="inline-flex h-11 items-center gap-2 rounded-md px-5 text-sm font-semibold"
            style={{ backgroundColor: palette.base, color: palette.onBrand }}
          >
            <Plus className="size-4" />
            New request
          </span>
        </div>

        <div className={cn("mt-6 flex flex-col gap-3", wide && "@lg:flex-row")}>
          <span
            // flex-1 only in the row layout: stacked, its 0 basis collapses the
            // box to its text height instead of the 48px the portal uses.
            className={cn(
              "flex h-12 min-w-0 shrink-0 items-center gap-3 rounded-xl border bg-white px-3.5 text-sm shadow-xs",
              wide && "@lg:flex-1",
            )}
            style={{ borderColor: border, color: palette.mutedText }}
          >
            <Search className="size-4.5 shrink-0" />
            <span className="truncate">Search your requests…</span>
          </span>
          <span
            className={cn(
              "flex h-12 w-full shrink-0 items-center justify-between gap-2 rounded-xl border bg-white px-4 text-sm shadow-xs",
              wide && "@lg:w-52",
            )}
            style={{ borderColor: border }}
          >
            All statuses
            <ChevronDown className="size-4 opacity-50" />
          </span>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="text-sm font-medium" style={muted}>
            {SAMPLE_REQUESTS.length} requests
          </span>
          <span
            className="flex items-center gap-1.5 px-2 text-xs whitespace-nowrap"
            style={muted}
          >
            <span>
              Sort by:{" "}
              <span className="font-semibold" style={{ color: palette.text }}>
                Last updated
              </span>
            </span>
            <ChevronDown className="size-4 opacity-50" />
          </span>
        </div>

        <div className="mt-3 flex flex-col gap-3">
          {SAMPLE_REQUESTS.map((request) => {
            const badge = SAMPLE_BADGE[request.state];

            return (
              <div
                key={request.number}
                className={cn(
                  "relative flex items-start gap-4 rounded-2xl border bg-white p-4 shadow-xs",
                  wide && "@lg:p-5",
                )}
                style={{ borderColor: border }}
              >
                {wide && (
                  <span
                    className="hidden size-12 shrink-0 items-center justify-center rounded-xl @lg:flex"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${palette.base} 10%, transparent)`,
                      color: palette.base,
                    }}
                  >
                    <FileText className="size-5" />
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "absolute top-5 right-5 shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                  <p
                    className="block h-6 truncate pe-28 text-xs leading-6 font-medium"
                    style={muted}
                  >
                    #{request.number}
                  </p>
                  <p className="mt-1 truncate text-base font-bold">
                    {request.subject}
                  </p>
                  <p className="mt-1 line-clamp-1 text-sm" style={muted}>
                    {request.preview}
                  </p>
                  <p
                    className="mt-2 flex items-start gap-1.5 text-xs"
                    style={muted}
                  >
                    <Clock3 className="mt-px size-3.5 shrink-0" />
                    {request.timestamp}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
