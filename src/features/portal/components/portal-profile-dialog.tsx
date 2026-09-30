"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Camera, CircleAlert, Loader2, Lock } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  prepareAvatarUploadAction,
  updateProfileAction,
} from "@/features/portal/actions/portal.actions";
import {
  AVATAR_MIME_TYPES,
  avatarError,
  type PortalCustomer,
} from "@/features/portal/portal";
import {
  portalProfileSchema,
  type PortalProfileValues,
} from "@/features/portal/schemas/portal.schema";
import { uploadAvatar } from "@/features/portal/avatar-upload";
import { applyFieldErrors } from "@/features/portal/form-errors";
import {
  portalToastError,
  portalToastResult,
  portalToastSuccess,
} from "@/features/portal/portal-toast";

/**
 * The customer's Profile settings: photo, name, and the email they sign in
 * with. Laid out like the team app's ProfileModal so the two read as one
 * product; the team-only parts (role, company, SLA alerts) are left out.
 */
export function PortalProfileDialog({
  open,
  onOpenChange,
  tenantSlug,
  tenantName,
  customer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantSlug: string;
  tenantName: string;
  customer: PortalCustomer;
}) {
  const [isSaving, setIsSaving] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !isSaving && onOpenChange(next)}
    >
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] gap-5 overflow-y-auto rounded-2xl p-5 sm:max-w-md sm:p-6">
        <DialogHeader className="gap-1 text-left">
          <DialogTitle className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
            Profile settings
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Customer · {tenantName} Support
          </DialogDescription>
        </DialogHeader>

        {/* Its own component so its state lives only while the dialog is
            open: Radix unmounts the content on close, so every opening starts
            from what is saved rather than from an abandoned edit. */}
        <ProfileForm
          tenantSlug={tenantSlug}
          customer={customer}
          isSaving={isSaving}
          setIsSaving={setIsSaving}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProfileForm({
  tenantSlug,
  customer,
  isSaving,
  setIsSaving,
  onDone,
}: {
  tenantSlug: string;
  customer: PortalCustomer;
  isSaving: boolean;
  setIsSaving: (saving: boolean) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    customer.avatarUrl,
  );
  const [error, setError] = useState<string | undefined>();

  const form = useForm<PortalProfileValues>({
    resolver: zodResolver(portalProfileSchema),
    defaultValues: {
      fullName: customer.fullName,
      company: customer.company ?? "",
    },
  });

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    // Cleared so picking the same file again still fires a change.
    event.target.value = "";

    if (!file) {
      return;
    }

    const problem = avatarError(file);

    if (problem) {
      setError(problem);
      return;
    }

    setError(undefined);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function onSubmit(values: PortalProfileValues) {
    setError(undefined);
    setIsSaving(true);

    try {
      let avatarPath: string | null = null;

      if (selectedFile) {
        const target = await prepareAvatarUploadAction(tenantSlug, {
          size: selectedFile.size,
          type: selectedFile.type,
        });

        if (!target.success) {
          setError(target.message);
          portalToastError(target.message);
          return;
        }

        await uploadAvatar(target.data, selectedFile);
        avatarPath = target.data.path;
      }

      const result = await updateProfileAction(tenantSlug, values, avatarPath);

      if (!result.success) {
        if (result.fieldErrors) {
          applyFieldErrors(form, result.fieldErrors);
        } else {
          setError(result.message);
        }
        portalToastResult(result);
        return;
      }

      // The dialog closes with this, so a toast is the only thing left saying
      // it worked. Fired before onDone, while the caller's state still holds.
      //
      // The name is echoed back rather than saying "profile saved": the name is
      // the one field here, it shows in the header and beside every request the
      // customer sends, and a typo is only visible if it comes back to them.
      // The company is echoed too, so a change to only that field still
      // reads back what was saved.
      const who = values.company
        ? `${values.fullName} at ${values.company}`
        : values.fullName;
      portalToastSuccess(
        selectedFile
          ? `Saved. You're ${who}, with your new photo.`
          : `Saved. You're ${who}.`,
      );

      onDone();
      // The header is server-rendered; refresh so it shows the new name/photo.
      router.refresh();
    } catch (uploadFailure) {
      const message =
        uploadFailure instanceof Error
          ? uploadFailure.message
          : "We couldn't save your profile. Try again.";

      setError(message);
      // No action result to inspect: the upload throws rather than returning
      // one, and it happened outside the form's own submit.
      portalToastError(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      {error ? (
        <Alert variant="destructive" className="rounded-[10px] px-3.5 py-3">
          <CircleAlert className="size-4.5" aria-hidden />
          <AlertDescription className="text-sm leading-[1.55]">
            {error}
          </AlertDescription>
        </Alert>
      ) : null}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <div className="flex items-center gap-4 rounded-xl border bg-muted/30 p-3.5 sm:p-4">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => fileInputRef.current?.click()}
              className="group relative shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <Avatar className="size-16 border-2 border-card shadow-sm sm:size-18">
                {previewUrl ? (
                  <AvatarImage
                    src={previewUrl}
                    alt=""
                    className="object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-brand-accent/10 text-lg font-bold text-brand-accent">
                  {customer.initials}
                </AvatarFallback>
              </Avatar>
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <Camera className="size-5 text-white" aria-hidden />
              </span>
              <span
                aria-hidden
                className="absolute -right-0.5 -bottom-0.5 flex size-6 items-center justify-center rounded-full border-2 border-card bg-brand-accent text-brand-accent-foreground shadow-sm"
              >
                <Camera className="size-3" />
              </span>
              <span className="sr-only">Change profile picture</span>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSaving}
                  onClick={() => fileInputRef.current?.click()}
                  className="h-8 border-brand-accent/30 text-xs font-semibold text-brand-ink hover:bg-brand-accent/5 hover:text-brand-ink"
                >
                  Change photo
                </Button>

                {/* Only for a photo picked in this session: it puts back
                    what is saved. Clearing a saved photo altogether is not
                    something the profile action supports yet. */}
                {selectedFile ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isSaving}
                    onClick={() => {
                      setSelectedFile(null);
                      setPreviewUrl(customer.avatarUrl);
                      setError(undefined);
                    }}
                    className="h-8 border-destructive/30 text-xs font-semibold text-destructive hover:bg-destructive/5 hover:text-destructive"
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {selectedFile
                  ? `${selectedFile.name} - saved when you press Save changes`
                  : "JPG, PNG, GIF or WebP · Max 5 MB"}
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={AVATAR_MIME_TYPES.join(",")}
              className="hidden"
              onChange={onFileChange}
            />
          </div>

          <FormField
            control={form.control}
            name="fullName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-semibold text-foreground">
                  Full name
                </FormLabel>
                <FormControl>
                  <Input
                    disabled={isSaving}
                    autoComplete="name"
                    className="h-11 rounded-lg text-sm"
                    {...field}
                  />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="company"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="gap-1.5 text-sm font-semibold text-foreground">
                  Company name
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </FormLabel>
                <FormControl>
                  <Input
                    disabled={isSaving}
                    autoComplete="organization"
                    placeholder="e.g. Acme Ltd"
                    maxLength={120}
                    className="h-11 rounded-lg text-sm"
                    {...field}
                  />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />

          {/* Not a form field: it is shown, never submitted. */}
          <div className="grid gap-2">
            <Label
              htmlFor="portal-profile-email"
              className="text-sm font-semibold text-foreground"
            >
              Email address
            </Label>
            <div className="relative">
              <Input
                id="portal-profile-email"
                type="email"
                value={customer.email}
                disabled
                readOnly
                aria-describedby="portal-profile-email-hint"
                className="h-11 rounded-lg bg-muted pr-10 text-sm text-muted-foreground disabled:opacity-100"
              />
              <Lock
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
            </div>
            <p
              id="portal-profile-email-hint"
              className="text-xs text-muted-foreground"
            >
              Your sign-in email can&apos;t be changed here.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 border-t pt-5 sm:flex sm:justify-end sm:gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={onDone}
              className="h-11 px-5 text-sm font-semibold"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSaving}
              className="h-11 px-5 text-sm font-semibold"
            >
              {isSaving ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </div>
        </form>
      </Form>
    </>
  );
}
