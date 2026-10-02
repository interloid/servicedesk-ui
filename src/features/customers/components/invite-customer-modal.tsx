"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Share2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { inviteCustomerAction } from "@/features/customers/actions/customers.actions";
import { CopyButton } from "@/features/customers/components/copy-button";
import { inviteCustomerSchema } from "@/features/customers/schemas/customers";
import {
  TEAM_DIALOG_CONTENT,
  TEAM_DIALOG_FOOTER,
  TEAM_DIALOG_TITLE,
  TEAM_MODAL_BUTTON,
  TEAM_MODAL_BUTTON_PRIMARY,
  TEAM_MODAL_CONTROL,
} from "@/features/team/components/modal-buttons";

/** The popup only asks for the address; the rest is filled in on the server. */
const shareByEmailSchema = inviteCustomerSchema.pick({ email: true });

type ShareByEmailValues = z.infer<typeof shareByEmailSchema>;

/**
 * "Share customer portal", for Tenant Admins on the Customers page. Two ways
 * in: copy the portal link and send it however you like, or have us email it.
 * An emailed invite also adds the customer to the list as Invited, with a
 * link that signs them straight in.
 */
export function InviteCustomerModal({ portalUrl }: { portalUrl: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ShareByEmailValues>({
    resolver: zodResolver(shareByEmailSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = ({ email }: ShareByEmailValues) => {
    const toastId = toast.loading(`Sending the portal link to ${email}…`);

    reset();
    setOpen(false);

    startTransition(async () => {
      try {
        const result = await inviteCustomerAction({ email });

        if (!result.ok) {
          toast.error(result.message, { id: toastId });
          return;
        }

        toast.success(`Portal link sent to ${email}.`, { id: toastId });
      } catch (error) {
        console.error("[customers] inviteCustomerAction failed", error);
        toast.error(
          `We couldn't email ${email}. Check your connection and try again.`,
          { id: toastId },
        );
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) {
          reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          disabled={isPending}
          className="h-10 gap-2 rounded-lg bg-brand-accent px-4 text-sm font-semibold text-brand-accent-foreground shadow-none hover:bg-brand-accent/90"
        >
          <Share2 className="size-4" aria-hidden />
          Invite customer
        </Button>
      </DialogTrigger>

      <DialogContent className={`sm:max-w-115 ${TEAM_DIALOG_CONTENT}`}>
        <DialogHeader className="pr-6">
          <DialogTitle className={TEAM_DIALOG_TITLE}>
            Share customer portal
          </DialogTitle>
          <DialogDescription>
            Give your customers access to your support portal. They can sign in
            to raise and track tickets.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="portal-link" className="text-sm font-semibold">
            Customer portal
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="portal-link"
              readOnly
              value={portalUrl}
              onFocus={(event) => event.currentTarget.select()}
              className={`${TEAM_MODAL_CONTROL} bg-muted/40 text-sm text-muted-foreground`}
            />
            <CopyButton value={portalUrl} label="Portal link" />
          </div>
        </div>

        <form
          id="share-portal-form"
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-1.5"
        >
          <Label htmlFor="customer-email" className="text-sm font-semibold">
            Send by email
          </Label>
          <Input
            id="customer-email"
            type="email"
            autoComplete="off"
            placeholder="customer@example.com"
            className={TEAM_MODAL_CONTROL}
            aria-invalid={Boolean(errors.email)}
            {...register("email")}
          />
          {errors.email ? (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          ) : (
            <p className="text-xs leading-[1.55] text-muted-foreground">
              The customer will receive the portal link by email. It signs them
              straight in, so they don&apos;t need an account or a password
              first.
            </p>
          )}
        </form>

        <DialogFooter className={TEAM_DIALOG_FOOTER}>
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              className={TEAM_MODAL_BUTTON}
            >
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="share-portal-form"
            size="sm"
            disabled={isPending}
            className={`${TEAM_MODAL_BUTTON} ${TEAM_MODAL_BUTTON_PRIMARY}`}
          >
            {isPending ? "Sending…" : "Send email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
