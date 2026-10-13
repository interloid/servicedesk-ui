"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import {
  createTicketAction,
  searchTicketRequestersAction,
} from "@/features/tickets/actions/tickets.actions";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Paperclip,
  Loader2,
  X,
  FileIcon,
  ChevronDown,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Customer } from "../services/tickets.service";
import {
  TICKET_ATTACHMENT_ACCEPT,
  TICKET_ATTACHMENT_HINT,
  attachmentsError,
} from "../lib/attachments";
import { discardTicketFiles, uploadTicketFiles } from "../lib/upload";
import type { TicketUploadedFile } from "../types/tickets.types";
import {
  TEAM_MODAL_BUTTON,
  TEAM_MODAL_BUTTON_PRIMARY,
} from "@/features/team/components/modal-buttons";
import { cn } from "@/lib/utils";

/**
 * Same field metrics as the SLA policy editor: 40px tall, 14px text. The
 * select needs its height on the data-size variant, which otherwise wins
 * over a plain h-* and pins it at 32px.
 */
const FIELD = "h-10 px-3 text-sm border-slate-200 focus:border-0";
const SELECT_TRIGGER = `${FIELD} w-full data-[size=default]:h-10 text-slate-800`;
const SELECT_ITEM = "p-2 text-sm";
/**
 * The close cross as a glyph, not a filled ghost button, lined up with the
 * header's title -- the SLA dialogs' cross (TEAM_DIALOG_CLOSE).
 */
const SHEET_CLOSE =
  "[&>[data-slot=sheet-close]]:border-0 [&>[data-slot=sheet-close]]:shadow-none [&>[data-slot=sheet-close]]:top-4 [&>[data-slot=sheet-close]]:right-4 [&>[data-slot=sheet-close]]:text-muted-foreground [&>[data-slot=sheet-close]]:hover:bg-transparent [&>[data-slot=sheet-close]]:hover:text-foreground [&>[data-slot=sheet-close]]:dark:hover:bg-transparent";

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
  const [requester, setRequester] = useState<Customer | null>(null);
  const requesterCustomerId = requester?.id ?? "";
  const [priority, setPriority] = useState("normal");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const id = setTimeout(() => subjectInputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open]);

  // The description is posted as the customer's first message, so nothing
  // is written for them -- not even a suggested wording in the placeholder,
  // which read as the customer's own words. Same hint as the portal form.
  const descriptionPlaceholder =
    "Describe what happened, when the issue started, and any steps already tried.";

  const resetForm = () => {
    setSubject("");
    setRequester(null);
    setPriority("normal");
    setDescription("");
    setFiles([]);
  };

  useEffect(() => {
    if (!open) queueMicrotask(resetForm);
  }, [open]);

  // Picks and drops add to the list; the size limit is on the whole set.
  const addFiles = (picked: File[]) => {
    if (picked.length === 0) return;
    const next = [...files, ...picked];
    const tooLarge = attachmentsError(next);
    if (tooLarge) {
      toast.error(tooLarge);
      return;
    }
    setFiles(next);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
    // Cleared so picking a file that was just removed fires again.
    e.target.value = "";
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

    startTransition(async () => {
      // The files go to storage first, straight from the browser; the
      // action gets their paths and files them once the ticket exists.
      let uploads: TicketUploadedFile[] = [];
      try {
        uploads = await uploadTicketFiles({ tenantSlug: tenant, files });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't upload the files. Please try again.",
        );
        return;
      }
      try {
        const result = await createTicketAction(tenant, formData, uploads);
        if (result?.success) {
          resetForm();
          onOpenChange(false);
        } else {
          await discardTicketFiles(tenant, undefined, uploads);
          toast.error(result?.error || "Failed to create ticket.");
        }
      } catch {
        await discardTicketFiles(tenant, undefined, uploads);
        toast.error("Couldn't create the ticket. Please try again.");
      }
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={cn(
          // Full width on phones; the sheet's own data-side defaults (3/4
          // wide, max-w-sm) out-rank plain w-/max-w- classes, so these
          // override them on the same variant.
          "flex flex-col p-0 font-sans data-[side=right]:w-full data-[side=right]:sm:max-w-md",
          SHEET_CLOSE,
        )}
      >
        <form
          onSubmit={handleSubmit}
          className="flex flex-col h-full overflow-hidden"
        >
          <SheetHeader className="px-4 py-5 pr-12 sm:px-6 sm:pr-12 border-b border-slate-100 bg-slate-50/50">
            <SheetTitle className="text-lg font-bold text-slate-900">
              New ticket
            </SheetTitle>
            <SheetDescription className="text-xs text-slate-500">
              Create a support request on behalf of a customer.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 space-y-4 text-xs text-slate-700">
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
                className={`${FIELD} placeholder:text-slate-400`}
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="requester"
                className="font-semibold text-slate-800 text-xs"
              >
                Requester <span className="text-red-500">*</span>
              </Label>
              <RequesterCombobox
                tenant={tenant}
                value={requester}
                onChange={setRequester}
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="priority"
                className="font-semibold text-slate-800 text-xs"
              >
                Priority
              </Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="priority" className={SELECT_TRIGGER}>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent
                  side="bottom"
                  align="start"
                  position="popper"
                  className="p-1"
                >
                  <SelectItem value="urgent" className={SELECT_ITEM}>
                    Urgent
                  </SelectItem>
                  <SelectItem value="high" className={SELECT_ITEM}>
                    High
                  </SelectItem>
                  <SelectItem value="normal" className={SELECT_ITEM}>
                    Normal
                  </SelectItem>
                  <SelectItem value="low" className={SELECT_ITEM}>
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
                placeholder={descriptionPlaceholder}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="bg-white text-slate-900 placeholder:text-slate-400 text-sm border-slate-200 resize-none p-3 shadow-sm"
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
                accept={TICKET_ATTACHMENT_ACCEPT}
                onChange={handleFileChange}
              />
              <div
                role="button"
                tabIndex={0}
                aria-label="Add attachments: drop files or browse"
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                // Without these the browser opens a dropped file itself,
                // leaving the app and losing the form.
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  addFiles(Array.from(e.dataTransfer.files));
                }}
                className="border border-dashed border-slate-300 hover:border-teal-600 focus-visible:border-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/20 bg-slate-50/50 hover:bg-slate-50 rounded-lg p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-colors"
              >
                <Paperclip className="w-4 h-4 text-slate-400 mb-1.5 rotate-45" />
                <p className="text-xs font-medium text-slate-700">
                  Drop files or{" "}
                  <span className="text-teal-700 underline">browse</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {TICKET_ATTACHMENT_HINT}
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
                        aria-label={`Remove ${file.name}`}
                        className="text-slate-400 hover:text-slate-600 ml-2"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* One column on phones with the primary action on top; a right-aligned
              row from sm up. */}
          <SheetFooter className="mt-auto flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50/50 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
            <SheetClose asChild>
              <Button
                type="button"
                variant="outline"
                className={cn(TEAM_MODAL_BUTTON, "bg-white")}
              >
                Cancel
              </Button>
            </SheetClose>
            <Button
              type="submit"
              disabled={isPending || !requesterCustomerId || !subject}
              className={cn(TEAM_MODAL_BUTTON, TEAM_MODAL_BUTTON_PRIMARY)}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {isPending ? "Creating…" : "Create ticket"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Searchable requester picker: the server returns up to 50 matches per query,
 * so the sheet opens fast however many customers the tenant has.
 */
function RequesterCombobox({
  tenant,
  value,
  onChange,
}: {
  tenant: string;
  value: Customer | null;
  onChange: (customer: Customer) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const requestId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const runSearch = (q: string, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    setLoading(true);
    setError(null);
    timer.current = setTimeout(() => {
      // Only the latest query may land; slower earlier ones are dropped.
      const id = ++requestId.current;
      searchTicketRequestersAction(tenant, q)
        .then((res) => {
          if (id !== requestId.current) return;
          if (res?.success) {
            setResults(res.customers ?? []);
            setHighlight(0);
          } else {
            setError(res?.error || "Failed to load customers");
          }
        })
        .catch(() => {
          if (id === requestId.current) setError("Failed to load customers");
        })
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    }, delay);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) runSearch(query, 0);
  };

  const pick = (customer: Customer) => {
    onChange(customer);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const customer = results[highlight];
      if (customer) pick(customer);
    }
  };

  return (
    <div>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            id="requester"
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              FIELD,
              "w-full justify-between bg-white font-normal hover:bg-white",
              value ? "text-slate-800" : "text-muted-foreground",
            )}
          >
            <span className="truncate">
              {value
                ? `${value.full_name}${value.company ? ` (${value.company})` : ""}`
                : "Select a customer"}
            </span>
            <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) p-0"
        >
          <div className="relative border-b border-slate-100">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <Input
              autoFocus
              value={query}
              placeholder="Search name, email or company"
              onChange={(e) => {
                setQuery(e.target.value);
                runSearch(e.target.value, 250);
              }}
              onKeyDown={handleKeyDown}
              aria-label="Search customers"
              className="h-10 rounded-none border-0 pl-8 text-sm shadow-none focus-visible:ring-0"
            />
          </div>
          <div role="listbox" className="max-h-60 overflow-y-auto p-1">
            {error ? (
              <p className="p-2 text-center text-sm text-red-500">{error}</p>
            ) : loading && results.length === 0 ? (
              <p className="flex items-center justify-center gap-2 p-2 text-sm text-slate-400">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Loading customers...
              </p>
            ) : results.length === 0 ? (
              <p className="p-2 text-center text-sm text-slate-400">
                No customers found
              </p>
            ) : (
              results.map((customer, idx) => (
                <button
                  key={customer.id}
                  type="button"
                  role="option"
                  aria-selected={value?.id === customer.id}
                  onClick={() => pick(customer)}
                  onMouseEnter={() => setHighlight(idx)}
                  ref={
                    idx === highlight
                      ? (el) => el?.scrollIntoView({ block: "nearest" })
                      : undefined
                  }
                  className={cn(
                    SELECT_ITEM,
                    "flex w-full flex-col items-start rounded-sm text-left",
                    idx === highlight && "bg-teal-50 text-teal-900",
                  )}
                >
                  <span className="truncate">
                    {customer.full_name}
                    {customer.company ? ` (${customer.company})` : ""}
                  </span>
                  <span className="truncate text-xs text-slate-400">
                    {customer.email}
                  </span>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
