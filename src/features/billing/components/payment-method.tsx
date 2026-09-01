"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface UpdatePaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentCardLast4?: string;
  invoiceId?: string;
  onSave?: (formData: Record<string, string>) => Promise<void>;
}

export function UpdatePaymentModal({
  open,
  onOpenChange,
  currentCardLast4,
  invoiceId,
  onSave,
}: UpdatePaymentModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    cardNumber: "",
    expiry: "",
    cvc: "",
    nameOnCard: "",
    billingEmail: "",
    billingAddress: "",
    taxId: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (onSave) await onSave(formData);
      onOpenChange(false);
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

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-900">
                Card number
              </Label>
              <Input
                required
                placeholder="4242 4242 4242 4242"
                value={formData.cardNumber}
                onChange={(e) =>
                  setFormData({ ...formData, cardNumber: e.target.value })
                }
                className="h-10 text-sm rounded-lg border-slate-200 focus-visible:ring-teal-700/20 focus-visible:border-teal-700 placeholder:text-slate-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-900">
                  Expiry
                </Label>
                <Input
                  required
                  placeholder="MM / YY"
                  value={formData.expiry}
                  onChange={(e) =>
                    setFormData({ ...formData, expiry: e.target.value })
                  }
                  className="h-10 text-sm rounded-lg border-slate-200 focus-visible:ring-teal-700/20 focus-visible:border-teal-700 placeholder:text-slate-400"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-900">CVC</Label>
                <Input
                  required
                  maxLength={4}
                  placeholder="123"
                  value={formData.cvc}
                  onChange={(e) =>
                    setFormData({ ...formData, cvc: e.target.value })
                  }
                  className="h-10 text-sm rounded-lg border-slate-200 focus-visible:ring-teal-700/20 focus-visible:border-teal-700 placeholder:text-slate-400"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-900">
                Name on card
              </Label>
              <Input
                required
                placeholder="Maya Okonkwo"
                value={formData.nameOnCard}
                onChange={(e) =>
                  setFormData({ ...formData, nameOnCard: e.target.value })
                }
                className="h-10 text-sm rounded-lg border-slate-200 focus-visible:ring-teal-700/20 focus-visible:border-teal-700 placeholder:text-slate-400"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-900">
                Billing email
              </Label>
              <Input
                type="email"
                required
                placeholder="finance@northwind.io"
                value={formData.billingEmail}
                onChange={(e) =>
                  setFormData({ ...formData, billingEmail: e.target.value })
                }
                className="h-10 text-sm rounded-lg border-slate-200 focus-visible:ring-teal-700/20 focus-visible:border-teal-700 placeholder:text-slate-400"
              />
              <p className="text-[11px] text-slate-400 pt-0.5">
                Receipts and dunning notices go here.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-900">
                Billing address
              </Label>
              <Input
                placeholder="221B, Indiranagar, Bengaluru 560038"
                value={formData.billingAddress}
                onChange={(e) =>
                  setFormData({ ...formData, billingAddress: e.target.value })
                }
                className="h-10 text-sm rounded-lg border-slate-200 focus-visible:ring-teal-700/20 focus-visible:border-teal-700 placeholder:text-slate-400"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-900">
                Tax / GST ID
              </Label>
              <Input
                placeholder="29ABCDE1234F1Z5"
                value={formData.taxId}
                onChange={(e) =>
                  setFormData({ ...formData, taxId: e.target.value })
                }
                className="h-10 text-sm rounded-lg border-slate-200 focus-visible:ring-teal-700/20 focus-visible:border-teal-700 placeholder:text-slate-400"
              />
            </div>

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
                type="submit"
                disabled={isSubmitting}
                className="rounded-lg bg-teal-800 text-white hover:bg-teal-900 font-semibold px-5 h-10 text-xs shadow-none"
              >
                {isSubmitting && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                )}
                Save and retry charge
              </Button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
