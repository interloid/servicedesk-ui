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

interface KeyboardShortcutsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHORTCUTS = [
  { description: "Focus search", keys: ["/"] },
  { description: "Go to ticket queue", keys: ["G", "then", "T"] },
  { description: "Go to billing", keys: ["G", "then", "B"] },
  { description: "New ticket", keys: ["N"] },
  { description: "Assign selected to me", keys: ["A"] },
  { description: "Mark selected solved", keys: ["E"] },
  { description: "Reply to open ticket", keys: ["R"] },
  { description: "Close panel or dialog", keys: ["Esc"] },
];

export function KeyboardShortcutsModal({
  open,
  onOpenChange,
}: KeyboardShortcutsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-140 w-full rounded-2xl p-6 [&>button]:top-6 [&>button]:right-6">
        <DialogHeader className="mb-4">
          <DialogTitle className="text-xl font-bold text-slate-900">
            Keyboard shortcuts
          </DialogTitle>
        </DialogHeader>

        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {SHORTCUTS.map((shortcut, index) => (
            <div
              key={index}
              className="flex items-center justify-between px-4 py-3 text-sm"
            >
              <span className="font-medium text-slate-700">
                {shortcut.description}
              </span>
              <div className="flex items-center gap-1">
                {shortcut.keys.map((key, kIndex) =>
                  key === "then" ? (
                    <span
                      key={kIndex}
                      className="px-1 text-xs font-normal text-slate-500"
                    >
                      then
                    </span>
                  ) : (
                    <kbd
                      key={kIndex}
                      className="inline-flex min-w-6 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs font-bold text-slate-800 shadow-sm"
                    >
                      {key}
                    </kbd>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <DialogClose asChild>
            <Button className="bg-[#0f766e] px-6 py-2.5 font-semibold text-white hover:bg-[#0d655e] rounded-lg">
              Done
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
