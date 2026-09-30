"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Info, Send, ShieldCheck, UserPlus } from "lucide-react";

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
import {
  TEAM_DIALOG_CONTENT,
  TEAM_DIALOG_FOOTER,
  TEAM_DIALOG_TITLE,
  TEAM_MODAL_BUTTON,
  TEAM_MODAL_BUTTON_PRIMARY,
} from "@/features/team/components/modal-buttons";
import { inviteCustomerToPortalAction } from "@/features/customers/actions/customers.actions";
import { formatCustomerRelative } from "@/features/customers/types/customers";

/**
 * Sending a portal invite, which mails a real person, so it asks first even
 * though there is nothing to type: the address is already on the customer
 * record and there is no choice to make.
 *
 * Pressing it again while an invite is outstanding is a resend, not a second
 * invite -- the pending membership row is written back to 'invited' and a fresh
 * link is queued -- so the button says "Resend invite" and names when the
 * first went out. The server decides the same thing again; this only saves the
 * click.
 *
 * A customer who has already signed in has nothing left to accept, so the
 * trigger stays in place -- a control that appears and disappears with the
 * customer's state is one nobody can account for -- and says so instead of
 * offering to mail an invite that would be refused.
 */
export function InviteCustomerModal({
  customerId,
  fullName,
  email,
  invitedAt,
  isResend,
  alreadyActive,
  now,
}: {
  customerId: string;
  fullName: string;
  email: string;
  /** When the outstanding invite went out; null when there isn't one. */
  invitedAt: string | null;
  isResend: boolean;
  /** portal_user_id is set, so they are already in and there is nothing to do. */
  alreadyActive: boolean;
  /** Server clock, so "sent 2 days ago" matches the rest of the page. */
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const sent = invitedAt ? formatCustomerRelative(invitedAt, now) : null;

  function onSend() {
    setOpen(false);

    startTransition(async () => {
      const toastId = toast.loading(`Sending an invite to ${email}…`);

      try {
        const result = await inviteCustomerToPortalAction({ customerId });

        if (!result.ok) {
          toast.error(
            result.message ?? `We couldn't invite ${fullName} to the portal.`,
            { id: toastId },
          );
          return;
        }

        toast.success(
          isResend
            ? `Invite resent to ${email}. Their earlier link stops working an hour after it was sent.`
            : `Invite sent to ${email}. They're in as soon as they sign in.`,
          { id: toastId },
        );
      } catch (error) {
        console.error("[customers] inviteCustomerToPortalAction failed", error);
        toast.error(
          "We couldn't send that invite. Check your connection and try again.",
          { id: toastId },
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-2 rounded-lg border-brand-accent/30 px-3 text-xs font-semibold text-brand-ink"
        >
          {alreadyActive ? (
            <ShieldCheck aria-hidden className="size-3.5" />
          ) : (
            <UserPlus aria-hidden className="size-3.5" />
          )}
          {alreadyActive
            ? "Portal active"
            : isResend
              ? "Resend invite"
              : "Invite to portal"}
        </Button>
      </DialogTrigger>

      <DialogContent className={`sm:max-w-115 ${TEAM_DIALOG_CONTENT}`}>
        <DialogHeader className="pr-6">
          <DialogTitle className={TEAM_DIALOG_TITLE}>
            {alreadyActive
              ? "Already has portal access"
              : isResend
                ? "Resend the portal invite"
                : "Invite to the portal"}
          </DialogTitle>
          <DialogDescription>
            {alreadyActive
              ? `${fullName} has already signed in to this workspace's portal, so there is nothing left to invite them to.`
              : `${fullName} gets a sign-in link for this workspace's support portal. It works once and expires in 1 hour.`}
          </DialogDescription>
        </DialogHeader>

        {alreadyActive ? (
          <ModalNotice icon={ShieldCheck} tone="accent" title={email}>
            <span className="text-xs leading-[1.55]">
              Their sign-in link is in the email thread, and the workspace can
              see their requests from the Tickets tab on this page.
            </span>
          </ModalNotice>
        ) : (
          <>
            <ModalNotice icon={Info} tone="neutral" title={email}>
              <span className="text-xs leading-[1.55]">
                Their access starts the first time they sign in, and the invite
                is recorded against this customer so the rest of the team can
                see it is outstanding.
              </span>
            </ModalNotice>

            {isResend && sent ? (
              <p className="text-xs text-muted-foreground">
                The last invite went out {sent}. Sending again puts a fresh link
                in their inbox; the old one expires an hour after it was sent,
                so their address may get two emails.
              </p>
            ) : null}
          </>
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
              {alreadyActive ? "Close" : "Cancel"}
            </Button>
          </DialogClose>
          {alreadyActive ? null : (
            <Button
              type="button"
              size="sm"
              onClick={onSend}
              disabled={isPending}
              className={`${TEAM_MODAL_BUTTON} ${TEAM_MODAL_BUTTON_PRIMARY}`}
            >
              {isResend ? (
                <Send aria-hidden className="size-4" />
              ) : (
                <UserPlus aria-hidden className="size-4" />
              )}
              {isPending
                ? "Sending…"
                : isResend
                  ? "Resend invite"
                  : "Send invite"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
