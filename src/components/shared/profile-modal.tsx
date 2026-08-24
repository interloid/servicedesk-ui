"use client";

import { useState, useRef, ChangeEvent } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { updateProfileAction } from "@/actions/user-actions";

interface ProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName?: string;
  tenantId: string;
  role: string;
  initialValues?: Partial<ProfileFormValues> & { initials?: string };
}

export function ProfileModal({
  open,
  onOpenChange,
  companyName = "Northwind Support",
  role,
  tenantId,
  initialValues,
}: ProfileModalProps) {
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
      slaNotification: initialValues?.slaNotification ?? true,
    },
  });

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert("Image must be under 5MB");
        return;
      }
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  async function onSubmit(data: ProfileFormValues) {
    setIsSubmitting(true);

    try {
      const result = await updateProfileAction(tenantId, data, selectedFile);

      if (result.success) {
        onOpenChange(false);
      } else if (result.errors) {
        Object.entries(result.errors).forEach(([key, messages]) => {
          form.setError(key as keyof ProfileFormValues, {
            message: messages?.[0],
          });
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                    {initialValues?.initials || "SO"}
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
                      className="h-11 text-xs sm:text-sm"
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
                    Work email
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      disabled={isSubmitting}
                      className="h-11 text-xs sm:text-sm"
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
                  className="bg-slate-100 text-slate-500 h-11 text-xs sm:text-sm"
                />
              </FormControl>
            </FormItem>

            <FormField
              control={form.control}
              name="slaNotification"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0 pt-2">
                  <FormControl>
                    <Switch
                      disabled={isSubmitting}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      className="shrink-0"
                    />
                  </FormControl>
                  <FormLabel className="text-xs sm:text-sm font-medium text-slate-800 cursor-pointer leading-tight">
                    Email me when a ticket breaches SLA
                  </FormLabel>
                </FormItem>
              )}
            />

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 sm:gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
                className="w-full sm:w-auto h-11 font-semibold text-xs sm:text-sm"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full sm:w-auto h-11 font-semibold text-xs sm:text-sm"
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
