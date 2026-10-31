"use client";

import { useState, useRef, useEffect, ChangeEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Camera } from "lucide-react";

import {
  ProfileFormValues,
  profileFormSchema,
} from "@/lib/validations/profile";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  prepareProfileAvatarUploadAction,
  updateProfileAction,
} from "@/actions/user-actions";
import { uploadAvatar } from "@/features/portal/avatar-upload";
import { avatarError } from "@/features/portal/portal";
import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";
import { toast } from "sonner";

interface ProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName: string;
  tenantId: string;
  role: string;
  /** False for roles that can't open the notification settings page. */
  showNotificationsLink?: boolean;
  initialValues?: Partial<ProfileFormValues> & { initials?: string };
}

export function ProfileModal({
  open,
  onOpenChange,
  companyName,
  role,
  tenantId,
  showNotificationsLink = true,
  initialValues,
}: ProfileModalProps) {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    initialValues?.avatarUrl || null,
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      fullName: initialValues?.fullName || "",
      email: initialValues?.email || "",
      avatarUrl: initialValues?.avatarUrl || "",
    },
  });

  // Backing out (Cancel, Esc, outside click) drops the picked photo and any
  // unsaved edits, so they are not saved by the next, unrelated save.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSelectedFile(null);
      setPreviewUrl(initialValues?.avatarUrl || null);
      form.reset({
        fullName: initialValues?.fullName || "",
        email: initialValues?.email || "",
        avatarUrl: initialValues?.avatarUrl || "",
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
    onOpenChange(next);
  };

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const problem = avatarError(file);
      if (problem) {
        toast.error(problem);
        return;
      }
      setSelectedFile(file);
      setPreviewUrl((previous) => {
        if (previous?.startsWith("blob:")) {
          URL.revokeObjectURL(previous);
        }
        return URL.createObjectURL(file);
      });
    }
  };

  async function onSubmit(data: ProfileFormValues) {
    setIsSubmitting(true);

    try {
      let avatarPath: string | null = null;

      // The photo goes straight to Storage with a single-use token; only its
      // path is sent to the action (Server Action bodies are capped at 1 MB).
      if (selectedFile) {
        const prepared = await prepareProfileAvatarUploadAction(tenantId, {
          size: selectedFile.size,
          type: selectedFile.type,
        });

        if (!prepared.success) {
          toast.error(prepared.message);
          return;
        }

        await uploadAvatar(prepared.data, selectedFile);
        avatarPath = prepared.data.path;
      }

      const result = await updateProfileAction(tenantId, data, avatarPath);

      if (result.success) {
        // Saved: keep the new photo as the starting point, then close.
        setSelectedFile(null);
        onOpenChange(false);
      } else if (result.errors) {
        Object.entries(result.errors).forEach(([key, messages]) => {
          form.setError(key as keyof ProfileFormValues, {
            message: messages?.[0],
          });
        });
      } else {
        toast.error(result.message);
      }
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "We couldn't save your profile. Try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md p-4 sm:p-6 rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="text-lg sm:text-xl font-bold text-slate-900">
            Profile settings
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm font-medium text-slate-500">
            {role} · {companyName}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4 pt-2"
          >
            <div className="flex items-center gap-3 sm:gap-4 py-2">
              <div
                className="relative group cursor-pointer shrink-0"
                onClick={() => fileInputRef.current?.click()}
              >
                <Avatar className="h-14 w-14 sm:h-16 sm:w-16 border">
                  {previewUrl && (
                    <AvatarImage
                      src={previewUrl}
                      alt="Avatar"
                      className="object-cover"
                    />
                  )}
                  <AvatarFallback className="bg-slate-200 text-slate-700 text-base sm:text-lg font-bold">
                    {initialValues?.initials || ""}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera className="h-5 w-5 text-primary-foreground " />
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSubmitting}
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs font-semibold"
                >
                  Change picture
                </Button>
                <p className="text-[11px] text-slate-500 mt-1">
                  JPG, PNG or GIF. 5MB max.
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png, image/jpeg, image/gif, image/webp"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-800 font-semibold text-xs sm:text-sm">
                    Full name
                  </FormLabel>
                  <FormControl>
                    <Input
                      disabled={isSubmitting}
                      className="h-10 text-sm"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-800 font-semibold text-xs sm:text-sm">
                    Email
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      disabled
                      className="h-10 text-sm"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            <FormItem>
              <FormLabel className="text-slate-800 font-semibold text-xs sm:text-sm">
                Company name
              </FormLabel>

              <FormControl>
                <Input
                  value={companyName}
                  disabled
                  className="bg-slate-100 text-slate-500 h-10 text-sm"
                />
              </FormControl>

              <p className="text-xs text-slate-500 mt-1">
                Contact support to update your company name.
              </p>
            </FormItem>
            {/* SLA and other email alerts live in the Notification center;
                a second switch here never saved and disagreed with it. */}
            {showNotificationsLink && tenantSlug && (
              <p className="text-xs sm:text-sm text-slate-500 pt-2">
                Choose which emails you get in{" "}
                <Link
                  href={tenantPath(
                    tenantSlug,
                    TENANT_ROUTES.SETTINGS.NOTIFICATIONS,
                  )}
                  onClick={() => handleOpenChange(false)}
                  className="font-semibold text-brand-accent hover:underline"
                >
                  Notification preferences
                </Link>
                .
              </p>
            )}

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 sm:gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => handleOpenChange(false)}
                className="h-10 w-full text-sm font-semibold sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="h-10 w-full text-sm font-semibold sm:w-auto"
              >
                {isSubmitting ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
