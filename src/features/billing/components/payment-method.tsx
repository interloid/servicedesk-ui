"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, Loader2, ExternalLink, CreditCard, Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import { updatePaymentMethodAction } from "../billing-actions";

interface UpdatePaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentCardLast4?: string;
  invoiceId?: string;
  tenantSlug?: string;
}

export function UpdatePaymentModal({
  open,
  onOpenChange,
  currentCardLast4,
  invoiceId,
  tenantSlug,
}: UpdatePaymentModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      if (result.updateUrl) {
        window.location.href = result.updateUrl;
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
          className="w-full max-w-120 rounded-2xl bg-white p-6 text-slate-900 shadow-2xl border border-slate-200 outline-none"
        >
          <DialogPrimitive.Close className="absolute right-5 top-5 rounded-md p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors focus:outline-none">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>

          <div className="space-y-1 mb-5">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              Update payment method
            </h2>
            <p className="text-xs text-slate-500 font-normal">
              {currentCardLast4
                ? `Replaces your current card ending in ${currentCardLast4}. `
                : "Add a payment method for this workspace. "}
              {invoiceId
                ? `We'll retry invoice ${invoiceId} straight away.`
                : "We'll retry any pending charges right away."}
            </p>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
              <div className="flex items-start space-x-3">
                <div className="rounded-lg bg-teal-100 p-2">
                  <CreditCard className="h-5 w-5 text-teal-700" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Secure payment update
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    You&apos;ll be redirected to PayPal to securely update your
                    payment method. Your card details are handled by PayPal and
                    never touch our servers.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2 text-xs text-slate-500">
              <Shield className="h-4 w-4 text-emerald-600" />
              <span>PCI DSS compliant - powered by PayPal</span>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}

            <div className="pt-4 flex flex-row items-center justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
                className="rounded-lg border border-slate-200 text-teal-800 hover:bg-slate-50 font-semibold px-5 h-10 text-xs shadow-none"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isSubmitting}
                onClick={handleUpdatePayment}
                className="rounded-lg bg-teal-800 text-white hover:bg-teal-900 font-semibold px-5 h-10 text-xs shadow-none"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    Updating...
                  </>
                ) : (
                  <>
                    Update on PayPal
                    <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
