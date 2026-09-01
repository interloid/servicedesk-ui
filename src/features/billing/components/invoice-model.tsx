"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface InvoiceData {
  invoiceNumber?: string;
  date?: string;
  agentsBilled?: number;
  amount?: string;
  status?: string;
  pdfUrl?: string;
}

interface InvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: InvoiceData;
}

export default function InvoiceModal({
  isOpen,
  onClose,
  invoice,
}: InvoiceModalProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const pdfUrl = invoice?.pdfUrl;
  const fileName = `${invoice?.invoiceNumber || "Invoice"}.pdf`;

  const handleDownload = async () => {
    if (!pdfUrl) {
      toast.error("This invoice has no PDF yet.");
      return;
    }

    try {
      setIsDownloading(true);

      const response = await fetch(pdfUrl);
      if (!response.ok) throw new Error("Failed to fetch file");

      const blob = await response.blob();

      if (blob.type !== "application/pdf" && !pdfUrl.endsWith(".pdf")) {
        throw new Error("Retrieved file is not a valid PDF");
      }

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();

      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.warn(
        "Direct blob download failed (likely CORS or wrong URL), falling back to new tab:",
        error,
      );
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-105 rounded-2xl p-6 border-none shadow-xl">
        <DialogHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <DialogTitle className="text-xl font-bold text-slate-900">
            Invoice {invoice?.invoiceNumber || "Details"}
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-xl border border-slate-200 p-4 space-y-3 bg-white">
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400 font-medium">Date</span>
            <span className="font-bold text-slate-800">
              {invoice?.date || "-"}
            </span>
          </div>

          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400 font-medium">Agents billed</span>
            <span className="font-bold text-slate-800">
              {invoice?.agentsBilled ?? "-"}
            </span>
          </div>

          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400 font-medium">Amount</span>
            <span className="font-bold text-slate-800">
              {invoice?.amount || "-"}
            </span>
          </div>

          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400 font-medium">Status</span>
            <Badge
              variant="outline"
              className={
                invoice?.status === "Failed"
                  ? "bg-red-50 text-red-600 border-none font-semibold rounded-full px-3 py-0.5 text-xs"
                  : "bg-emerald-50 text-emerald-600 border-none font-semibold rounded-full px-3 py-0.5 text-xs"
              }
            >
              <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-red-500 inline-block" />
              {invoice?.status || "Unknown"}
            </Badge>
          </div>
        </div>

        <DialogFooter className="flex-row justify-end gap-3 pt-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="rounded-xl border-emerald-800 text-teal-800 hover:bg-teal-50 font-semibold px-6"
          >
            Close
          </Button>

          <Button
            type="button"
            onClick={handleDownload}
            disabled={isDownloading || !pdfUrl}
            className="rounded-xl bg-teal-800 hover:bg-teal-900 text-white font-semibold px-5"
          >
            {isDownloading ? "Downloading..." : "Download PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
