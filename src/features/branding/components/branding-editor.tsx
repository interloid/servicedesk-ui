"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  AtSign,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  LockKeyhole,
  Mail,
  MessageSquare,
  MonitorSmartphone,
  Paperclip,
  Plus,
  RotateCw,
  Search,
  SendHorizontal,
  Star,
  Upload,
  UserPlus,
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
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { createSupabaseClient } from "@/lib/supabase/client";
import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";
import { cn } from "@/lib/utils";

import type {
  BrandingField,
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
  HEX_COLOR,
  isHexColor,
  LOGO_BUCKET,
  LOGO_MIME_TYPES,
  MAX_LOGO_BYTES,
  MAX_NAME_LENGTH,
  MAX_SLUG_LENGTH,
  MIN_READABLE_CONTRAST,
  SLUG_PATTERN,
} from "@/features/branding/branding";
import {
  checkSlugAvailabilityAction,
  prepareLogoUploadAction,
  updateBrandingAction,
} from "@/features/branding/branding-actions";
import {
  CopyButton,
  CopyScope,
  CopyTrigger,
} from "@/features/customers/components/copy-button";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  PORTAL_ROUTES,
  portalPath,
} from "@/features/portal/portal";
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
  "h-9 gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold shadow-none";
const PAGE_BUTTON_PRIMARY = `${PAGE_BUTTON} bg-brand-accent text-brand-accent-foreground hover:bg-brand-accent/90`;
const PAGE_BUTTON_OUTLINE = `${PAGE_BUTTON} bg-white`;

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

type FieldErrors = Partial<Record<BrandingField, string>>;

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
  const router = useRouter();
  const [draft, setDraft] = useState<TenantBranding>(branding);
  const [saved, setSaved] = useState<TenantBranding>(branding);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(true);
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
  const leaveGuard = useUnsavedChangesGuard(canEdit && dirty);
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
    } else if (slugStatus === "checking") {
      next.slug = "Still checking this address. Try again in a moment.";
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

    setErrors(next);

    // The extra settings can be collapsed; reopen them so the message is
    // actually visible.
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
        const message = result.message ?? "We couldn't save your branding.";
        const field = result.field;

        if (field) {
          setErrors((prev) => ({ ...prev, [field]: message }));
          if (
            field === "secondaryColor" ||
            field === "textColor" ||
            field === "backgroundColor" ||
            field === "email"
          ) {
            setMoreOpen(true);
          }
        }

        toast.error(message);
        return;
      }

      if (result.data) {
        setDraft(result.data);
        setSaved(result.data);
      }

      toast.success("Branding saved.");

      // This page lives under the old address; the server has already moved
      // the session to the new one.
      if (result.data && result.data.slug !== saved.slug) {
        router.replace(
          tenantPath(result.data.slug, TENANT_ROUTES.SETTINGS.BRANDING),
        );
      }
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
    <div className="h-full overflow-y-auto p-4 font-sans text-slate-900 sm:p-6 lg:p-8 xl:overflow-hidden">
      <div className="mx-auto flex w-full flex-col gap-6 xl:h-full">
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

        <div className="grid grid-cols-1 items-start gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)] xl:grid-rows-[minmax(0,1fr)] xl:items-stretch">
          <div className="@container flex min-w-0 flex-col rounded-[14px] border border-border bg-card p-4 sm:p-5 xl:overflow-y-auto">
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
                <div className="relative flex items-center gap-3 rounded-[12px] border border-border p-3.5">
                  <BrandMark
                    logoUrl={logoUrl}
                    initials={initials}
                    palette={palette}
                    className="size-14 rounded-[10px] text-xl"
                  />
                  <div className="flex min-w-0 flex-1 flex-col pr-24">
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
                      className={`h-8 self-end rounded-lg px-3 text-xs font-semibold shadow-none ${TEAM_MODAL_BUTTON_DANGER}`}
                      onClick={() => setConfirm("remove-logo")}
                      disabled={pending || uploading}
                    >
                      Remove
                    </Button>
                  )}

                  <div className="absolute top-3 right-3.5 flex items-center gap-2">
                    <Label
                      htmlFor="branding-logo-on-portal"
                      className="text-xs font-semibold text-foreground"
                    >
                      Show logo
                    </Label>
                    <Switch
                      id="branding-logo-on-portal"
                      checked={draft.showLogoOnPortal}
                      onCheckedChange={(v) => set({ showLogoOnPortal: v })}
                      disabled={!canEdit}
                    />
                  </div>
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
                {/* On a narrow card the host and /portal crowd the slug out,
                    so they hide there; the full link is spelled out below. */}
                <span
                  className="hidden max-w-[45%] min-w-0 flex-none items-center border-r border-input bg-muted px-3 text-muted-foreground @sm:flex"
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
                <span className="pointer-events-none flex flex-none items-center pr-3 text-xs text-muted-foreground tabular-nums">
                  {draft.slug.length}/{MAX_SLUG_LENGTH}
                </span>
                <span className="hidden flex-none items-center border-l border-input bg-muted px-3 text-muted-foreground @sm:flex">
                  {PORTAL_ROUTES.ROOT}
                </span>
              </div>

              {errors.slug ? (
                <p className="text-sm text-destructive-strong">{errors.slug}</p>
              ) : (
                <SlugStatus status={slugStatus} url={portalLoginUrl} />
              )}

              {canEdit && slug && slug !== saved.slug && (
                <Notice tone="warn">
                  Saving moves your workspace and portal to this address. Links
                  and bookmarks to the old address stop working.
                </Notice>
              )}
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

          <div className="flex min-w-0 flex-col gap-4 rounded-[14px] border border-border bg-card p-4 sm:p-5 xl:overflow-hidden">
            <div className="flex items-start gap-3">
              <span className="flex size-11 flex-none items-center justify-center rounded-[10px] bg-brand-soft text-brand-ink">
                <Eye className="size-5" />
              </span>
              <div className="flex flex-col gap-0.5">
                <h2 className="text-lg font-semibold tracking-tight">
                  Live portal preview
                </h2>
                <p className="text-sm text-muted-foreground">
                  See how your branding looks across the customer portal.
                </p>
              </div>
            </div>

            <PortalPreview
              palette={palette}
              name={displayName}
              showLogo={draft.showLogoOnPortal}
              logoUrl={logoUrl}
              initials={initials}
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

      <UnsavedChangesDialog
        open={leaveGuard.pendingHref !== null}
        onStay={leaveGuard.stay}
        onLeave={leaveGuard.leave}
        description="Your branding changes haven't been saved. If you leave this page now, they will be lost."
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

  // Only the saved address is live, so only it is offered for copying.
  if (status === "current") {
    return (
      <CopyScope value={url} label="Portal link">
        <div className="flex items-center gap-1.5 text-xs font-medium text-success-strong">
          <span className="flex size-3.5 flex-none items-center justify-center rounded-full bg-success text-white">
            <Check className="size-2" strokeWidth={3} />
          </span>

          <span className="min-w-0 flex-1">
            <CopyTrigger className="inline">{url}</CopyTrigger> is your current
            address
          </span>

          <CopyButton value={url} label="Portal link" />
        </div>
      </CopyScope>
    );
  }

  if (status === "available") {
    return (
      <p className="flex items-start gap-2 text-sm font-medium text-success-strong">
        <span className="mt-0.5 flex size-4 flex-none items-center justify-center rounded-full bg-success text-white">
          <Check className="size-2.5" strokeWidth={3} />
        </span>
        <span className="min-w-0">{link} is available</span>
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
        <p className="text-xs text-destructive-strong">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

type SampleState = "open" | "waiting_on_you";

// Labels and colours copied from the portal's requests list (STATE_BADGE).
const SAMPLE_BADGE: Record<SampleState, { label: string; className: string }> =
  {
    open: { label: "Open", className: "bg-sky-50 text-sky-700" },
    waiting_on_you: {
      label: "Waiting on you",
      className: "bg-amber-50 text-amber-700",
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
    preview: "I'm unable to login to my account.",
    timestamp: "Opened today, 11:22 · Updated 9 min ago",
    state: "open",
  },
  {
    number: 1233,
    subject: "Unable to upload files",
    preview: "File upload shows an error.",
    timestamp: "Opened today, 10:15 · Updated 1 hour ago",
    state: "waiting_on_you",
  },
];

const SAMPLE_RATINGS = ["Poor", "Not great", "Okay", "Good", "Excellent"];

const SAMPLE_LIMITS = `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files · ${Math.round(
  MAX_ATTACHMENT_BYTES / (1024 * 1024),
)} MB per file`;

const PREVIEW_BORDER = "rgba(15, 23, 42, 0.1)";

/** `currentColor` at a given strength — washes that follow the text colour. */
function tint(percent: number) {
  return `color-mix(in srgb, currentColor ${percent}%, transparent)`;
}

/** The brand colour at a given strength over transparent. */
function brandTint(palette: BrandPalette, percent: number) {
  return `color-mix(in srgb, ${palette.base} ${percent}%, transparent)`;
}

/**
 * The portal's main screens side by side, each a scaled-down static copy of the
 * real one (sign-in, check inbox, requests, ticket thread, CSAT, new request),
 * under one full-size portal header. Everything is painted with inline colours
 * from the palette rather than BrandTheme: BrandTheme rewrites the page-wide
 * custom properties, which would rebrand this settings screen too.
 *
 * The page's own breakpoints never fire in here — the preview is a box inside a
 * wide page — so the gallery switches on the preview's own width with container
 * queries: one column, two from `@xl`, and the 3 + 4 desktop rows from `@4xl`.
 */
function PortalPreview({
  palette,
  name,
  showLogo,
  logoUrl,
  initials,
}: {
  palette: BrandPalette;
  name: string;
  /** Off hides the mark entirely: no logo and no initial tile, just the name. */
  showLogo: boolean;
  logoUrl: string | null;
  initials: string;
}) {
  // Same casing rule the portal header applies to the tenant name.
  const headerName = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  const brand = { palette, headerName, showLogo, logoUrl, initials };
  const top = "@4xl:col-span-4";
  const bottom = "@4xl:col-span-3";

  return (
    <div
      className="@container flex w-full min-w-0 flex-col overflow-hidden rounded-[12px] border border-border xl:min-h-0 xl:flex-1"
      aria-hidden
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-muted px-3 py-2.5">
        <span className="size-2.5 rounded-full bg-red-300" />
        <span className="size-2.5 rounded-full bg-amber-300" />
        <span className="size-2.5 rounded-full bg-emerald-300" />
      </div>

      <div className="grid max-h-[70vh] grid-cols-1 gap-3 overflow-y-auto bg-white p-3 @xl:grid-cols-2 @4xl:grid-cols-12 xl:max-h-none xl:min-h-0 xl:flex-1">
        <ScreenCard icon={<FileText />} title="Requests list" className={top}>
          <RequestsScreen {...brand} />
        </ScreenCard>
        <ScreenCard
          icon={<Mail />}
          title="Sign in (magic link)"
          className={top}
        >
          <MagicLinkScreen palette={palette} />
        </ScreenCard>
        <ScreenCard icon={<Mail />} title="Check inbox" className={top}>
          <CheckInboxScreen palette={palette} />
        </ScreenCard>
        <ScreenCard
          icon={<LockKeyhole />}
          title="Password sign in"
          className={bottom}
        >
          <PasswordScreen palette={palette} />
        </ScreenCard>
        <ScreenCard
          icon={<MessageSquare />}
          title="Ticket details"
          className={bottom}
        >
          <TicketScreen palette={palette} />
        </ScreenCard>
        <ScreenCard
          icon={<Star />}
          title="Customer feedback"
          className={bottom}
        >
          <FeedbackScreen palette={palette} />
        </ScreenCard>
        <ScreenCard icon={<Plus />} title="Create ticket" className={bottom}>
          <CreateTicketScreen palette={palette} />
        </ScreenCard>
      </div>
    </div>
  );
}

type PreviewBrand = {
  palette: BrandPalette;
  headerName: string;
  showLogo: boolean;
  logoUrl: string | null;
  initials: string;
};

/** The portal's mark: the logo, the initial tile, or nothing when hidden. */
function PreviewMark({
  showLogo,
  logoUrl,
  initials,
  className,
}: Omit<PreviewBrand, "palette" | "headerName"> & { className: string }) {
  if (!showLogo) return null;
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        className={cn("shrink-0 rounded-md object-cover", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md font-extrabold",
        className,
      )}
      style={{ backgroundColor: tint(15) }}
    >
      {initials}
    </span>
  );
}

/** One labelled screen in the gallery; the label is settings UI, not portal. */
function ScreenCard({
  icon,
  title,
  className,
  children,
}: {
  icon: React.ReactElement<{ className?: string }>;
  title: string;
  className?: string | false;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-slate-100 p-2.5",
        className,
      )}
    >
      <div className="flex items-center gap-2.5 px-0.5">
        <span className="flex size-7 flex-none items-center justify-center rounded-lg bg-white text-muted-foreground [&>svg]:size-3.5">
          {icon}
        </span>
        <span className="truncate text-sm font-semibold">{title}</span>
      </div>
      {children}
    </div>
  );
}

/** The portal page behind a screen: white, with the brand text colour. */
function MiniPage({
  palette,
  className,
  children,
}: {
  palette: BrandPalette;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col overflow-hidden rounded-lg border text-[11px] leading-snug",
        className,
      )}
      style={{
        backgroundColor: "#ffffff",
        color: palette.text,
        borderColor: PREVIEW_BORDER,
      }}
    >
      {children}
    </div>
  );
}

/** A white card on the portal page, like the sign-in and form panels. */
function MiniPanel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("rounded-lg border bg-white p-3 shadow-xs", className)}
      style={{ borderColor: PREVIEW_BORDER }}
    >
      {children}
    </div>
  );
}

function MiniIcon({
  palette,
  children,
}: {
  palette: BrandPalette;
  children: React.ReactNode;
}) {
  return (
    <span
      className="flex size-7 items-center justify-center rounded-md [&>svg]:size-3.5"
      style={{ backgroundColor: brandTint(palette, 10), color: palette.base }}
    >
      {children}
    </span>
  );
}

function MiniLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <p className="mt-2.5 mb-1 text-[10px] font-semibold">
      {children}
      {required && <span className="text-red-600"> *</span>}
    </p>
  );
}

function MiniInput({
  palette,
  className,
  children,
}: {
  palette: BrandPalette;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-7 items-center gap-2 rounded-md border bg-white px-2 text-[10px]",
        className,
      )}
      style={{ borderColor: PREVIEW_BORDER, color: palette.mutedText }}
    >
      {children}
    </div>
  );
}

function MiniButton({
  palette,
  variant = "solid",
  className,
  children,
}: {
  palette: BrandPalette;
  variant?: "solid" | "outline";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-[10px] font-semibold whitespace-nowrap [&>svg]:size-3",
        variant === "outline" && "border bg-white",
        className,
      )}
      style={
        variant === "solid"
          ? { backgroundColor: palette.base, color: palette.onBrand }
          : { borderColor: PREVIEW_BORDER, color: palette.text }
      }
    >
      {children}
    </span>
  );
}

function MiniLink({
  palette,
  children,
}: {
  palette: BrandPalette;
  children: React.ReactNode;
}) {
  return (
    <span className="font-semibold" style={{ color: palette.base }}>
      {children}
    </span>
  );
}

function MiniDivider({ palette }: { palette: BrandPalette }) {
  return (
    <div
      className="my-2 flex items-center gap-2 text-[9px]"
      style={{ color: palette.mutedText }}
    >
      <span
        className="h-px flex-1"
        style={{ backgroundColor: PREVIEW_BORDER }}
      />
      or
      <span
        className="h-px flex-1"
        style={{ backgroundColor: PREVIEW_BORDER }}
      />
    </div>
  );
}

function RequestsScreen({ palette, headerName, ...mark }: PreviewBrand) {
  const muted = { color: palette.mutedText };

  return (
    <MiniPage palette={palette}>
      <div
        className="flex h-8 items-center justify-between gap-2 px-2.5 text-[10px] font-semibold"
        style={{ backgroundColor: palette.base, color: palette.onBrand }}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <PreviewMark {...mark} className="size-4.5 text-[9px]" />
          <span className="truncate">{headerName} Support</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span
            className="rounded px-1.5 py-0.5"
            style={{ backgroundColor: tint(12) }}
          >
            Help centre
          </span>
          <span className="flex size-4.5 items-center justify-center rounded-full bg-slate-900 text-[8px] text-white">
            J
          </span>
        </span>
      </div>

      <div className="flex flex-col gap-2 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold">Your requests</span>
          <MiniButton palette={palette}>
            <Plus />
            New request
          </MiniButton>
        </div>

        <div className="flex gap-1.5">
          <MiniInput palette={palette} className="min-w-0 flex-1">
            <Search className="size-3 shrink-0" />
            <span className="truncate">Search your requests…</span>
          </MiniInput>
          <MiniInput palette={palette} className="shrink-0 justify-between">
            <span style={{ color: palette.text }}>All statuses</span>
            <ChevronDown className="size-3" />
          </MiniInput>
        </div>

        {SAMPLE_REQUESTS.map((request) => {
          const badge = SAMPLE_BADGE[request.state];

          return (
            <div
              key={request.number}
              className="flex items-start gap-2 rounded-lg border bg-white p-2"
              style={{ borderColor: PREVIEW_BORDER }}
            >
              <MiniIcon palette={palette}>
                <FileText />
              </MiniIcon>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-medium" style={muted}>
                    #{request.number}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-px text-[9px] font-semibold whitespace-nowrap",
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                </div>
                <p className="truncate font-bold">{request.subject}</p>
                <p className="truncate text-[10px]" style={muted}>
                  {request.preview}
                </p>
                <p
                  className="mt-0.5 flex items-center gap-1 truncate text-[9px]"
                  style={muted}
                >
                  <Clock3 className="size-2.5 shrink-0" />
                  <span className="truncate">{request.timestamp}</span>
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </MiniPage>
  );
}

function MagicLinkScreen({ palette }: { palette: BrandPalette }) {
  const muted = { color: palette.mutedText };

  return (
    <MiniPage palette={palette} className="justify-center p-2.5">
      <MiniPanel>
        <MiniIcon palette={palette}>
          <Mail />
        </MiniIcon>
        <p className="mt-2 text-xs font-bold">Track your requests</p>
        <p className="mt-0.5 text-[10px]" style={muted}>
          Use the email you contact us from. We&apos;ll send a sign-in link - no
          password needed.
        </p>
        <MiniLabel>Email address</MiniLabel>
        <MiniInput palette={palette}>you@company.com</MiniInput>
        <MiniButton palette={palette} className="mt-2">
          Email me a sign-in link
        </MiniButton>
        <MiniDivider palette={palette} />
        <p className="text-center text-[10px]">
          <MiniLink palette={palette}>Sign in with a password instead</MiniLink>
        </p>
      </MiniPanel>

      <div
        className="mt-2 rounded-lg border p-2.5 text-[10px]"
        style={{ borderColor: PREVIEW_BORDER, backgroundColor: tint(3) }}
      >
        <p className="flex items-center gap-1.5 font-semibold">
          <UserPlus className="size-3" style={{ color: palette.base }} />
          First time here?
        </p>
        <p className="mt-1" style={muted}>
          You don&apos;t need an account to reach us.{" "}
          <MiniLink palette={palette}>Submit a request</MiniLink> and we&apos;ll
          set one up from your email.
        </p>
      </div>
    </MiniPage>
  );
}

function CheckInboxScreen({ palette }: { palette: BrandPalette }) {
  const muted = { color: palette.mutedText };

  return (
    <MiniPage palette={palette} className="justify-center p-2.5">
      <MiniPanel>
        <MiniIcon palette={palette}>
          <Mail />
        </MiniIcon>
        <p className="mt-2 text-xs font-bold">Check your inbox</p>
        <p className="mt-0.5 text-[10px]" style={muted}>
          We sent a sign-in link to
        </p>
        <MiniInput palette={palette} className="mt-1.5">
          <span className="truncate" style={{ color: palette.text }}>
            jordan@company.com
          </span>
        </MiniInput>
        <p className="mt-2 flex gap-1.5 text-[10px]" style={muted}>
          <MonitorSmartphone
            className="mt-px size-3 shrink-0"
            style={{ color: palette.base }}
          />
          <span>
            <span className="font-semibold" style={{ color: palette.text }}>
              Open it on any device.
            </span>{" "}
            The link signs you in wherever you open it, and works once.
          </span>
        </p>
        <MiniButton palette={palette} className="mt-2.5">
          <RotateCw />
          Resend link
        </MiniButton>
        <MiniButton palette={palette} variant="outline" className="mt-1.5">
          <AtSign />
          Use a different email
        </MiniButton>
      </MiniPanel>
    </MiniPage>
  );
}

function PasswordScreen({ palette }: { palette: BrandPalette }) {
  return (
    <MiniPage palette={palette} className="justify-center p-2.5">
      <MiniPanel>
        <p className="text-xs font-bold">Sign in to your account</p>
        <p className="mt-0.5 text-[10px]" style={{ color: palette.mutedText }}>
          Use the email you contact us from, and the password you set here.
        </p>
        <MiniLabel>Email address</MiniLabel>
        <MiniInput palette={palette}>you@company.com</MiniInput>
        <MiniLabel>Password</MiniLabel>
        <MiniInput palette={palette} className="justify-between">
          <span style={{ color: palette.text }}>••••••••••</span>
          <EyeOff className="size-3" />
        </MiniInput>
        <MiniButton palette={palette} className="mt-2.5">
          Sign in
        </MiniButton>
        <MiniDivider palette={palette} />
        <p className="text-center text-[10px]">
          <MiniLink palette={palette}>Use a sign-in link instead</MiniLink>
        </p>
      </MiniPanel>
    </MiniPage>
  );
}

function TicketScreen({ palette }: { palette: BrandPalette }) {
  const muted = { color: palette.mutedText };

  return (
    <MiniPage palette={palette} className="p-2.5">
      <span
        className="flex items-center gap-1 text-[10px] font-semibold"
        style={{ color: palette.base }}
      >
        <ArrowLeft className="size-3" />
        Your requests
      </span>
      <p className="mt-1.5 text-xs font-bold">Product delivery issue</p>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px]">
        <span
          className="rounded-full border bg-white px-1.5 py-px font-semibold"
          style={{ borderColor: PREVIEW_BORDER }}
        >
          #7
        </span>
        <span className="rounded-full bg-sky-50 px-1.5 py-px font-semibold text-sky-700">
          Open
        </span>
        <span style={muted}>· Updated 1 day ago</span>
      </div>

      <div className="mt-2.5 flex flex-1 flex-col gap-2">
        <span
          className="self-center rounded-full px-2 py-px text-[9px] font-medium"
          style={{ backgroundColor: tint(6), ...muted }}
        >
          Thursday
        </span>
        <div className="flex flex-col items-end gap-0.5">
          <span
            className="max-w-[85%] rounded-lg rounded-br-sm px-2 py-1.5 text-[10px]"
            style={{
              backgroundColor: brandTint(palette, 12),
              color: palette.text,
            }}
          >
            Payment isn&apos;t going through on the website.
          </span>
          <span className="text-[9px]" style={muted}>
            5:23 PM
          </span>
        </div>
        <div className="flex items-start gap-1.5">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[8px] font-semibold text-white">
            KT
          </span>
          <div className="min-w-0">
            <p className="text-[9px]" style={muted}>
              <span className="font-semibold" style={{ color: palette.text }}>
                Karthick
              </span>{" "}
              · Support team · 11:12 AM
            </p>
            <span
              className="mt-0.5 inline-block rounded-lg rounded-tl-sm border bg-white px-2 py-1.5 text-[10px]"
              style={{ borderColor: PREVIEW_BORDER }}
            >
              Thanks, I&apos;m looking into it now.
            </span>
          </div>
        </div>
      </div>

      <MiniInput palette={palette} className="mt-2.5">
        Write your reply…
      </MiniInput>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span
          className="flex min-w-0 items-center gap-1 text-[9px]"
          style={muted}
        >
          <Paperclip
            className="size-3 shrink-0"
            style={{ color: palette.base }}
          />
          <span className="truncate">Attach files</span>
        </span>
        <MiniButton palette={palette}>
          <SendHorizontal />
          Send
        </MiniButton>
      </div>
    </MiniPage>
  );
}

function FeedbackScreen({ palette }: { palette: BrandPalette }) {
  return (
    <MiniPage palette={palette} className="justify-center p-2.5">
      <MiniPanel className="text-center">
        <p className="text-xs font-bold">How did we do?</p>
        <p className="mt-0.5 text-[10px]" style={{ color: palette.mutedText }}>
          Pick a rating, then submit. It goes straight to the engineer who
          handled this.
        </p>
        <div className="mt-2.5 grid grid-cols-5 gap-1">
          {SAMPLE_RATINGS.map((label, index) => {
            const on = index < 4;
            return (
              <span
                key={label}
                className="flex min-w-0 flex-col items-center gap-1"
              >
                <span
                  className="flex aspect-square w-full max-w-8 items-center justify-center rounded-md border"
                  style={{
                    borderColor: on ? palette.base : PREVIEW_BORDER,
                    backgroundColor: on ? brandTint(palette, 10) : "white",
                  }}
                >
                  <Star
                    className="size-3.5"
                    style={{
                      color: on ? palette.base : palette.mutedText,
                      fill: on ? palette.base : "transparent",
                    }}
                  />
                </span>
                <span
                  className="w-full truncate text-[8px]"
                  style={{ color: palette.mutedText }}
                >
                  {label}
                </span>
              </span>
            );
          })}
        </div>
        <MiniInput
          palette={palette}
          className="mt-2.5 h-10 items-start py-1.5 text-left"
        >
          Anything you&apos;d like to add? (optional)
        </MiniInput>
        <MiniButton palette={palette} className="mx-auto mt-2.5 w-fit">
          <SendHorizontal />
          Submit rating
        </MiniButton>
      </MiniPanel>
    </MiniPage>
  );
}

function CreateTicketScreen({ palette }: { palette: BrandPalette }) {
  const muted = { color: palette.mutedText };

  return (
    <MiniPage palette={palette} className="justify-center p-2.5">
      <MiniPanel>
        <p className="text-xs font-bold">Create a ticket</p>
        <p className="mt-0.5 text-[10px]" style={muted}>
          Tell us what you need help with and our support team will get back to
          you.
        </p>
        <MiniLabel required>Subject</MiniLabel>
        <MiniInput palette={palette}>
          <span className="truncate">
            e.g. Can&apos;t log in after SSO switch
          </span>
        </MiniInput>
        <MiniLabel required>Description</MiniLabel>
        <MiniInput palette={palette} className="h-10 items-start py-1.5">
          <span className="line-clamp-2">
            Describe what happened, when the issue started, and any steps
            you&apos;ve already tried.
          </span>
        </MiniInput>
        <MiniLabel>Attachments</MiniLabel>
        <div
          className="flex items-center gap-2 rounded-md border border-dashed p-1.5 text-[9px]"
          style={{ borderColor: PREVIEW_BORDER, ...muted }}
        >
          <Upload
            className="size-3.5 shrink-0"
            style={{ color: palette.base }}
          />
          <span className="min-w-0">
            <span className="block truncate">
              Drop files or <MiniLink palette={palette}>browse</MiniLink>
            </span>
            <span className="block truncate">{SAMPLE_LIMITS}</span>
          </span>
        </div>
        <div className="mt-2.5 flex justify-end gap-1.5">
          <MiniButton palette={palette} variant="outline">
            Cancel
          </MiniButton>
          <MiniButton palette={palette}>Create ticket</MiniButton>
        </div>
      </MiniPanel>
    </MiniPage>
  );
}
