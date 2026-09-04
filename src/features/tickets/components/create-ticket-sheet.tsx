"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { createTicketAction } from "@/features/tickets/actions/tickets.actions";
import { getCustomersAction } from "@/features/customers/actions/customers.actions";
import { Customer } from "@/features/customers/services/customers.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Paperclip, Loader2, X, FileIcon } from "lucide-react";

interface CreateTicketSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: string;
}

export default function CreateTicketSheet({
  open,
  onOpenChange,
  tenant,
}: CreateTicketSheetProps) {
  const [isPending, startTransition] = useTransition();

  const [subject, setSubject] = useState("");
  const [requesterCustomerId, setRequesterCustomerId] = useState("");
  const [priority, setPriority] = useState("normal");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const id = setTimeout(() => subjectInputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open]);

  const autoDescriptionRef = useRef<string | null>(null);

  useEffect(() => {
    const trimmed = subject.trim();
    const customer = customers.find(
      (c) => String(c.id) === requesterCustomerId,
    );
    const company = customer?.company || "our team";
    const template = `Hi — raising this from ${company}. ${trimmed}. Happy to send logs if that helps.`;
    const usingAuto =
      description === autoDescriptionRef.current ||
      autoDescriptionRef.current === null;
    if (usingAuto && trimmed) {
      setDescription(template);
      autoDescriptionRef.current = template;
    }
  }, [subject, requesterCustomerId, customers, description]);

  const resetForm = () => {
    setSubject("");
    setRequesterCustomerId("");
    setPriority("normal");
    setDescription("");
    setFiles([]);
    autoDescriptionRef.current = null;
  };

  useEffect(() => {
    if (open && tenant) {
      queueMicrotask(() => {
        setLoadingCustomers(true);
        setCustomerError(null);
      });
      getCustomersAction(tenant)
        .then((res) => {
          if (res?.success && res.customers) {
            setCustomers(res.customers);
          } else {
            setCustomerError(res?.error || "Failed to load customers");
          }
        })
        .catch(() => {
          setCustomerError("Failed to load customers");
        })
        .finally(() => setLoadingCustomers(false));
    } else if (!open) {
      queueMicrotask(resetForm);
    }
  }, [open, tenant]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const formData = new FormData();
    formData.append("subject", subject);
    formData.append("requesterCustomerId", requesterCustomerId);
    formData.append("priority", priority);
    formData.append("description", description);

    files.forEach((file) => {
      formData.append("files", file);
    });

    startTransition(async () => {
      const result = await createTicketAction(tenant, formData);
      if (result?.success) {
        resetForm();
        onOpenChange(false);
      }
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md w-full flex flex-col p-0 font-sans border-l border-slate-200">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col h-full overflow-hidden"
        >
          <SheetHeader className="px-6 py-5 border-b border-slate-100 bg-slate-50/50">
            <SheetTitle className="text-lg font-bold text-slate-900">
              New ticket
            </SheetTitle>
            <SheetDescription className="text-xs text-slate-500">
              Create a support request on behalf of a customer.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 text-xs text-slate-700">
            <div className="space-y-1.5">
              <Label
                htmlFor="subject"
                className="font-semibold text-slate-800 text-xs"
              >
                Subject <span className="text-red-500">*</span>
              </Label>
              <Input
                id="subject"
                ref={subjectInputRef}
                placeholder="Short summary the customer will see"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
                className="h-9 text-xs border-slate-200 placeholder:text-slate-400"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="requester"
                className="font-semibold text-slate-800 text-xs"
              >
                Requester <span className="text-red-500">*</span>
              </Label>
              <Select
                value={requesterCustomerId}
                onValueChange={setRequesterCustomerId}
                disabled={loadingCustomers}
              >
                <SelectTrigger
                  id="requester"
                  className="h-9 w-full text-xs border-slate-200 text-slate-800 focus:ring-teal-700"
                >
                  <SelectValue
                    placeholder={
                      loadingCustomers
                        ? "Loading customers..."
                        : "Select a customer"
                    }
                  />
                </SelectTrigger>
                <SelectContent side="bottom" align="start" position="popper">
                  {customers.length === 0 && !loadingCustomers ? (
                    <div className="p-2 text-xs text-slate-400 text-center">
                      No customers found
                    </div>
                  ) : (
                    customers.map((customer) => (
                      <SelectItem
                        key={customer.id}
                        value={String(customer.id)}
                        className="text-xs"
                      >
                        {customer.full_name}{" "}
                        {customer.company ? `(${customer.company})` : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {customerError && (
                <p className="text-xs text-red-500 mt-1">{customerError}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="priority"
                className="font-semibold text-slate-800 text-xs"
              >
                Priority
              </Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger
                  id="priority"
                  className="h-9 w-full text-xs border-slate-200 text-slate-800 focus:ring-teal-700"
                >
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent side="bottom" align="start" position="popper">
                  <SelectItem value="urgent" className="text-xs">
                    Urgent
                  </SelectItem>
                  <SelectItem value="high" className="text-xs">
                    High
                  </SelectItem>
                  <SelectItem value="normal" className="text-xs">
                    Normal
                  </SelectItem>
                  <SelectItem value="low" className="text-xs">
                    Low
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="description"
                className="font-semibold text-slate-800 text-xs"
              >
                Description
              </Label>
              <Textarea
                id="description"
                rows={4}
                placeholder="What happened, what you expect, and anything you've already tried."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="bg-white text-slate-900 placeholder:text-slate-400 text-xs border-slate-200 resize-none p-3 shadow-sm"
              />
            </div>

            <div className="space-y-2">
              <Label className="font-semibold text-slate-800 text-xs">
                Attachments
              </Label>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept=".png,.jpg,.jpeg,.pdf,.log"
                onChange={handleFileChange}
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border border-dashed border-slate-300 hover:border-teal-600 bg-slate-50/50 hover:bg-slate-50 rounded-lg p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-colors"
              >
                <Paperclip className="w-4 h-4 text-slate-400 mb-1.5 rotate-45" />
                <p className="text-xs font-medium text-slate-700">
                  Drop files or{" "}
                  <span className="text-teal-700 underline">browse</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  PNG, JPG, PDF, LOG up to 20 MB
                </p>
              </div>

              {files.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {files.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between bg-slate-100/80 rounded px-2.5 py-1.5 text-xs text-slate-700"
                    >
                      <div className="flex items-center truncate space-x-2">
                        <FileIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{file.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(idx)}
                        className="text-slate-400 hover:text-slate-600 ml-2"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <SheetFooter className="p-4 border-t border-slate-100 flex-row justify-end space-x-2 bg-slate-50/50 mt-auto">
            <SheetClose asChild>
              <Button
                type="button"
                variant="outline"
                className="border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-medium h-9 px-4"
              >
                Cancel
              </Button>
            </SheetClose>
            <Button
              type="submit"
              disabled={isPending || !requesterCustomerId || !subject}
              className="bg-teal-800 hover:bg-teal-900 text-white text-xs font-medium h-9 px-4 shadow-sm"
            >
              {isPending && (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              )}
              Create ticket
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
