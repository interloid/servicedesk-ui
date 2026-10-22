"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { shortcutAccess } from "@/components/shared/layout/global-shortcuts";

interface KeyboardShortcutsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The viewer's role: only the shortcuts it can use are listed. */
  role?: string | null;
}

type Shortcut = {
  description: string;
  keys: string[];
  /** Hidden from roles that can't use it; none = everyone. */
  needs?: "tickets" | "billing";
};

const SHORTCUTS: Shortcut[] = [
  { description: "Focus search", keys: ["/"], needs: "tickets" },
  {
    description: "Go to ticket queue",
    keys: ["G", "then", "T"],
    needs: "tickets",
  },
  { description: "Go to billing", keys: ["G", "then", "B"], needs: "billing" },
  { description: "New ticket", keys: ["N"], needs: "tickets" },
  { description: "Assign selected to me", keys: ["A"], needs: "tickets" },
  { description: "Mark selected solved", keys: ["E"], needs: "tickets" },
  { description: "Reply to open ticket", keys: ["R"], needs: "tickets" },
  { description: "Close panel or dialog", keys: ["Esc"] },
];

export function KeyboardShortcutsModal({
  open,
  onOpenChange,
  role,
}: KeyboardShortcutsModalProps) {
  // Without a role (older callers) every shortcut shows, as before.
  const access = role === undefined ? null : shortcutAccess(role);
  const shortcuts = access
    ? SHORTCUTS.filter((s) => !s.needs || access[s.needs])
    : SHORTCUTS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-140 max-h-[85vh] flex flex-col rounded-2xl p-4 sm:p-6 [&>button]:top-4 sm:[&>button]:top-6 [&>button]:right-4 sm:[&>button]:right-6">
        <DialogHeader className="mb-2 sm:mb-4 shrink-0 text-left">
          <DialogTitle className="text-lg sm:text-xl font-bold text-slate-900">
            Keyboard shortcuts
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto min-h-0 flex-1 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {shortcuts.map((shortcut, index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm"
            >
              <span className="font-medium text-slate-700 truncate min-w-0 pr-2">
                {shortcut.description}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                {shortcut.keys.map((key, kIndex) =>
                  key === "then" ? (
                    <span
                      key={kIndex}
                      className="px-0.5 text-[10px] sm:text-xs font-normal text-slate-500"
                    >
                      then
                    </span>
                  ) : (
                    <kbd
                      key={kIndex}
                      className="inline-flex min-w-5 sm:min-w-6 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-1.5 sm:px-2 py-0.5 sm:py-1 font-mono text-[10px] sm:text-xs font-bold text-slate-800 shadow-xs"
                    >
                      {key}
                    </kbd>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 sm:mt-4 flex justify-end shrink-0">
          <DialogClose asChild>
            <Button className="w-full sm:w-auto px-6 h-11 font-semibold text-xs sm:text-sm">
              Done
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
