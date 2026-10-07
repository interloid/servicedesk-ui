"use client";

import { useTransition } from "react";
import {
  MailPlus,
  MoreHorizontalIcon,
  Pause,
  Play,
  Send,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import {
  inviteExistingCustomerAction,
  setCustomerAccessAction,
  type InviteCustomerResult,
} from "@/features/customers/actions/customers.actions";
import {
  CUSTOMER_STATUS_BADGE,
  type CustomerPortalStatus,
} from "@/features/customers/types/customers";

/** The customer's portal status, in the team table's badge colours. */
export function CustomerStatusBadge({
  status,
  className,
}: {
  status: CustomerPortalStatus;
  className?: string;
}) {
  return (
    <Badge
      className={cn(
        "h-6 px-2.5 text-xs font-semibold",
        CUSTOMER_STATUS_BADGE[status],
        className,
      )}
    >
      {status}
    </Badge>
  );
}

type AccessAction = {
  label: string;
  icon: LucideIcon;
  run: () => Promise<InviteCustomerResult>;
  success: string;
  failure: string;
};

/**
 * The "…" menu for one customer's portal access, for Tenant Admins. Shown on
 * the Customers list and on the customer's own page.
 *
 * - Not invited: Invite to portal, Disable access (blocks self sign-up)
 * - Invited: Resend invite, Disable access
 * - Active: Disable access
 * - Disabled: Enable access
 */
export function CustomerAccessMenu({
  customer,
  className,
}: {
  customer: {
    id: string;
    fullName: string;
    email: string;
    portalStatus: CustomerPortalStatus;
  };
  className?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const { id, fullName, email, portalStatus } = customer;

  const actions: AccessAction[] = [];

  if (portalStatus === "Not invited") {
    actions.push({
      label: "Invite to portal",
      icon: Send,
      run: () => inviteExistingCustomerAction({ customerId: id }),
      success: `Invite sent to ${email}.`,
      failure: `We couldn't invite ${fullName}.`,
    });
  }

  if (portalStatus === "Invited") {
    actions.push({
      label: "Resend invite",
      icon: MailPlus,
      run: () => inviteExistingCustomerAction({ customerId: id }),
      success: `Invite resent to ${email}.`,
      failure: `We couldn't resend the invite to ${email}.`,
    });
  }

  // Every status but Disabled: a customer who was never invited can still
  // sign themselves in through the portal, so they can be blocked too.
  if (portalStatus !== "Disabled") {
    actions.push({
      label: "Disable access",
      icon: Pause,
      run: () => setCustomerAccessAction({ customerId: id, enabled: false }),
      success: `${fullName} can no longer sign in to your support portal.`,
      failure: `We couldn't disable ${fullName}.`,
    });
  }

  if (portalStatus === "Disabled") {
    actions.push({
      label: "Enable access",
      icon: Play,
      run: () => setCustomerAccessAction({ customerId: id, enabled: true }),
      success: `${fullName} can sign in to your support portal again.`,
      failure: `We couldn't enable ${fullName}.`,
    });
  }

  const run = (action: AccessAction) =>
    startTransition(async () => {
      try {
        const result = await action.run();

        if (!result.ok) {
          toast.error(result.message);
          return;
        }

        toast.success(action.success);
      } catch (error) {
        console.error("[customers] access action failed", error);
        toast.error(`${action.failure} Check your connection and try again.`);
      }
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={isPending}
          aria-label={`Portal access for ${fullName}`}
          className={cn(
            "size-9 rounded-lg border border-none text-muted-foreground hover:bg-muted hover:text-foreground",
            className,
          )}
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {actions.map((action) => {
          const Icon = action.icon;

          return (
            <DropdownMenuItem
              key={action.label}
              disabled={isPending}
              onSelect={() => run(action)}
              className="p-2 cursor-pointer"
            >
              <Icon />
              {action.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
