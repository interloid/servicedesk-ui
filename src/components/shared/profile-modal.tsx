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
  initialValues?: Partial<ProfileFormValues> & { initials?: string };
}

export function ProfileModal({
  open,
  onOpenChange,
  companyName = "Northwind Support",
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
      <DialogContent className="sm:max-w-120 p-6 rounded-2xl">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="text-xl font-bold text-slate-900">
            Profile settings
          </DialogTitle>
          <DialogDescription className="text-sm font-medium text-slate-500">
            Agent · {companyName}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4 pt-2"
          >
            {/* Profile Picture Upload Section */}
            <div className="flex items-center gap-4 py-2">
              <div
                className="relative group cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Avatar className="h-16 w-16 border">
                  {previewUrl && (
                    <AvatarImage
                      src={previewUrl}
                      alt="Avatar"
                      className="object-cover"
                    />
                  )}
                  <AvatarFallback className="bg-slate-200 text-slate-700 text-lg font-bold">
                    {initialValues?.initials || "SO"}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera className="h-5 w-5 text-white" />
                </div>
              </div>

              <div>
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

            {/* Full Name */}
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-800 font-semibold">
                    Full name
                  </FormLabel>
                  <FormControl>
                    <Input disabled={isSubmitting} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Work Email */}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-800 font-semibold">
                    Work email
                  </FormLabel>
                  <FormControl>
                    <Input type="email" disabled={isSubmitting} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Read-Only Company Name */}
            <FormItem>
              <FormLabel className="text-slate-800 font-semibold">
                Company name
              </FormLabel>
              <FormControl>
                <Input
                  value={companyName}
                  disabled
                  className="bg-slate-100 text-slate-500"
                />
              </FormControl>
            </FormItem>

            {/* SLA Notification Toggle */}
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
                      className="data-[state=checked]:bg-emerald-800"
                    />
                  </FormControl>
                  <FormLabel className="text-sm font-medium text-slate-800 cursor-pointer">
                    Email me when a ticket breaches SLA
                  </FormLabel>
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
                className="border-slate-300 text-emerald-800 hover:bg-slate-50 font-semibold"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-emerald-800 hover:bg-emerald-900 text-white font-semibold"
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
