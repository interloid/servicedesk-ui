import React from "react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function TicketsEmptyState({
  title = "Queue clear",
  description = "Nothing matches this view right now. Change the filters, or raise a ticket on a customer's behalf.",
  actionLabel = "New ticket",
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center w-full">
      <div className="w-12 h-12 rounded-xl bg-teal-50 text-teal-800 flex items-center justify-center mb-4">
        <Inbox className="w-6 h-6" />
      </div>

      <h3 className="text-base font-bold text-slate-900">{title}</h3>
      <p className="text-xs text-slate-500 max-w-sm mt-1.5 mb-5 leading-relaxed">
        {description}
      </p>

      {onAction && (
        <Button
          onClick={onAction}
          className="bg-teal-800 hover:bg-teal-900 text-white text-xs font-semibold h-9 px-4 rounded-md transition-colors"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
