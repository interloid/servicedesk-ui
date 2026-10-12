"use client";

import { useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
import { SavedView } from "../services/saved-views.service";
import { deleteSavedViewAction } from "../actions/saved-views.actions";

interface DeleteSavedViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: string;
  view: SavedView | null;
}

export default function DeleteSavedViewDialog({
  open,
  onOpenChange,
  tenant,
  view,
}: DeleteSavedViewDialogProps) {
  const [isPending, startTransition] = useTransition();

  if (!view) return null;

  const handleDelete = () => {
    startTransition(async () => {
      const res = await deleteSavedViewAction(tenant, view.id);
      if (res.success) {
        onOpenChange(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-100 p-6 font-sans rounded-2xl bg-white border border-slate-100 shadow-xl [&>button]:hidden">
        <DialogHeader className="space-y-2">
          <div className="flex items-center space-x-2 text-red-600">
            <AlertTriangle className="w-5 h-5" />
            <DialogTitle className="text-base font-bold text-slate-900">
              Delete view
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-slate-500 pt-1">
            Are you sure you want to delete{" "}
            <span className="font-semibold text-slate-900">
              &quot;{view.name}&quot;
            </span>
            ? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-end space-x-2 pt-4">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
            className="h-9 px-4 text-xs font-semibold text-slate-700 border-slate-200 hover:bg-slate-50 rounded-lg shadow-none"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isPending}
            onClick={handleDelete}
            className="h-9 px-4 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg shadow-none"
          >
            {isPending && (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            )}
            Delete view
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
