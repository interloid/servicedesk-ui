"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, Loader2, ExternalLink, Shield, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MODAL_BUTTON } from "./modal-buttons";
import { ModalNotice } from "./modal-notice";
import { updatePaymentMethodAction } from "../billing-actions";

interface UpdatePaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceType?: "card" | "paypal" | "none";
  paypalEmail?: string;
  paypalPayerName?: string;
  invoiceId?: string;
  tenantSlug?: string;
  onSynced?: () => void;
}

export function UpdatePaymentModal({
  open,
  onOpenChange,
  sourceType = "none",
  paypalEmail,
  paypalPayerName,
  invoiceId,
  tenantSlug,
  onSynced,
}: UpdatePaymentModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentToPayPal, setSentToPayPal] = useState(false);

  const isWallet = sourceType === "paypal";

  const handleUpdatePayment = async () => {
    if (!tenantSlug) {
      setError("Tenant slug is required.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await updatePaymentMethodAction(tenantSlug);

      if (!result.success) {
        setError(result.error || "Failed to update payment method.");
        return;
      }

      if (result.manageUrl) {
        // Opened in a new tab rather than navigated to: PayPal's Automatic
        // Payments screen has no way back to this app, and the customer needs
        // this page still open to refresh once they are done.
        window.open(result.manageUrl, "_blank", "noopener,noreferrer");
        setSentToPayPal(true);
      } else {
        onOpenChange(false);
      }
    } catch (err) {
      console.error("Update payment method error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDone = () => {
    setSentToPayPal(false);
    onOpenChange(false);
    onSynced?.();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-9998 bg-black/40 backdrop-blur-xs" />
        <DialogPrimitive.Content
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 9999,
          }}
          className="w-[calc(100%-2rem)] max-w-120 rounded-2xl bg-white p-6 text-slate-900 shadow-2xl border border-slate-200 outline-none"
        >
          <div className="mb-5 space-y-1">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-bold tracking-tight text-slate-900">
                {isWallet
                  ? "Manage your PayPal payment"
                  : "Update payment method"}
              </h2>

              <DialogPrimitive.Close className="-mr-1.5 shrink-0 rounded-md p-1.5 text-slate-400 transition-colors duration-200 ease-out hover:bg-slate-100 hover:text-slate-600 focus:outline-none motion-safe:active:scale-[0.98]">
                <X className="h-5 w-5" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>
            <p className="text-xs text-slate-500 font-normal">
              {invoiceId
                ? `We'll retry invoice ${invoiceId} once the new details go through.`
                : "Any pending charges are retried automatically."}
            </p>
          </div>

          {isWallet && (
            <div className="mb-5 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="rounded-lg bg-slate-100 p-2">
                <Wallet className="h-4 w-4 text-slate-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-900">
                  {paypalPayerName ?? "PayPal account"}
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  {paypalEmail ?? "Billed through your PayPal account"}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                Current
              </span>
            </div>
          )}

          <div className="space-y-4">
            <ModalNotice
              icon={Wallet}
              title={
                sentToPayPal
                  ? "Finish in the PayPal tab"
                  : "Change it in PayPal"
              }
            >
              {sentToPayPal
                ? "Pick a different funding source for this subscription, then come back and select Done so we can refresh what's on file."
                : "Swapping the funding source behind a running agreement has to happen on PayPal's side. We'll open its automatic payments settings, where you can change the card or bank account. Your plan, workspace and subscription stay exactly as they are — nothing is re-created, and your card details never touch our servers."}
            </ModalNotice>

            <div className="flex items-center space-x-2 text-xs text-slate-500">
              <Shield className="h-4 w-4 text-emerald-600" />
              <span>PCI DSS compliant - powered by PayPal</span>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 pt-4 sm:flex-row sm:items-center sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
                className={MODAL_BUTTON}
              >
                Cancel
              </Button>
              {sentToPayPal ? (
                <Button
                  type="button"
                  onClick={handleDone}
                  className={cn(
                    MODAL_BUTTON,
                    "bg-teal-800 text-white hover:bg-teal-900",
                  )}
                >
                  Done
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleUpdatePayment}
                  className={cn(
                    MODAL_BUTTON,
                    "bg-teal-800 text-white hover:bg-teal-900",
                  )}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Opening PayPal...
                    </>
                  ) : (
                    <>
                      Open PayPal
                      <ExternalLink className="h-3.5 w-3.5" />
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
