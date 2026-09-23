"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { ModalNotice } from "@/components/shared/modal-notice";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  TEAM_DIALOG_CONTENT,
  TEAM_DIALOG_FOOTER,
  TEAM_DIALOG_TITLE,
  TEAM_MODAL_BUTTON,
  TEAM_MODAL_BUTTON_PRIMARY,
  TEAM_MODAL_CONTROL,
} from "@/features/team/components/modal-buttons";
import {
  inviteMemberSchema,
  type InviteMemberValues,
} from "@/features/team/schemas/team";
import {
  hasSeatLeft,
  roleWithArticle,
  TEAM_ROLE_DESCRIPTIONS,
  TEAM_ROLE_VALUES,
  type TeamRole,
  type TeamSeats,
} from "@/features/team/types/team";
import { inviteMemberAction } from "@/features/team/team-actions";
import { Info, TriangleAlert, UserPlus } from "lucide-react";

interface InviteMemberModalProps {
  children?: React.ReactNode;
  /**
   * Seat state at render time. The server re-checks on submit -- this only
   * saves the customer from typing out an invite that was never going to send.
   */
  seats: TeamSeats;
}

type InviteForm = {
  email: string;
  role: TeamRole;
};

export function InviteMemberModal({ children, seats }: InviteMemberModalProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const seatsLeft = hasSeatLeft(seats);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteForm>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: {
      email: "",
      role: "Agent",
    },
  });

  const onSubmit = (data: InviteForm) => {
    const values: InviteMemberValues = {
      email: data.email,
      role: data.role,
    };

    startTransition(async () => {
      try {
        const result = await inviteMemberAction(values);

        if (!result.ok) {
          toast.error(
            result.message ?? `We couldn't send the invite to ${values.email}.`,
          );
          return;
        }

        toast.success(
          `Invite sent to ${values.email}. They'll join as ${roleWithArticle(values.role)} once they accept.`,
        );
        reset();
        setOpen(false);
      } catch (error) {
        // The call itself can reject on a dropped connection. Without this the
        // dialog just sat there with no toast and no explanation.
        console.error("[team] inviteMemberAction failed", error);
        toast.error(
          `We couldn't send the invite to ${values.email}. Check your connection and try again.`,
        );
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button className="h-10 gap-2 rounded-lg bg-brand-accent px-4 text-sm font-semibold text-brand-accent-foreground shadow-none hover:bg-brand-accent/90">
            <UserPlus className="size-4" aria-hidden />
            Invite member
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className={`sm:max-w-115 ${TEAM_DIALOG_CONTENT}`}>
        <DialogHeader className="pr-6">
          <DialogTitle className={TEAM_DIALOG_TITLE}>
            Invite a member
          </DialogTitle>
          <DialogDescription>
            They&apos;ll receive an email invitation that expires in 7 days.
          </DialogDescription>
        </DialogHeader>

        {!seatsLeft && (
          <ModalNotice
            icon={TriangleAlert}
            tone="amber"
            title="All of your seats are in use"
          >
            <span className="text-xs leading-[1.55]">
              Your plan includes {seats.limit} seat
              {seats.limit === 1 ? "" : "s"}. Remove or disable someone on the
              team, or upgrade your plan, to invite anyone else.
            </span>
          </ModalNotice>
        )}

        <form
          id="invite-member-form"
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-sm font-semibold">
              Email address
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="off"
              placeholder="name@company.com"
              className={TEAM_MODAL_CONTROL}
              aria-invalid={Boolean(errors.email)}
              {...register("email")}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="role" className="text-sm font-semibold">
              Role
            </Label>

            <Controller
              name="role"
              control={control}
              render={({ field }) => (
                <>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="role" className="w-full min-h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      side="bottom"
                      align="start"
                      position="popper"
                      className="p-1"
                    >
                      {TEAM_ROLE_VALUES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <p className="text-xs text-muted-foreground">
                    {TEAM_ROLE_DESCRIPTIONS[field.value]}
                  </p>
                </>
              )}
            />
          </div>
        </form>

        {seatsLeft && (
          <ModalNotice
            icon={Info}
            tone="neutral"
            title="This invitation will count toward your seat limit"
          >
            <span className="text-xs leading-[1.55]">
              The member can access the workspace after accepting the
              invitation.
            </span>
          </ModalNotice>
        )}

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
            form="invite-member-form"
            size="sm"
            disabled={isPending || !seatsLeft}
            className={`${TEAM_MODAL_BUTTON} ${TEAM_MODAL_BUTTON_PRIMARY}`}
          >
            {isPending ? "Sending…" : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
