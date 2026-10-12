"use client";

import { useState } from "react";
import Link from "next/link";
import {
  describeFilter,
  filterToSearchParams,
  normalizeFilter,
} from "../filters";
import {
  Bookmark,
  Edit2,
  GripVertical,
  MoreVertical,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelativeTime } from "@/lib/format";
import { SavedView } from "../services/saved-views.service";
import CreateSavedViewDialog from "./create-saved-view-dialog";
import DeleteSavedViewDialog from "./delete-saved-view-dialog";

interface SavedViewsListProps {
  initialViews: SavedView[];
  tenant: string;
  /** Server render time, so "2 hours ago" matches on hydration. */
  now: number;
}

export default function SavedViewsList({
  initialViews = [],
  tenant,
  now,
}: SavedViewsListProps) {
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const [selectedView, setSelectedView] = useState<SavedView | null>(null);

  // Order is local only for now: there is no sort column on saved_views yet,
  // so a reload goes back to created_at order. Persisting it comes later.
  const [views, setViews] = useState(initialViews);
  const [prevInitialViews, setPrevInitialViews] = useState(initialViews);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // A create/edit/delete refreshes the page and hands down a new list. Keep
  // the order the user dragged into, drop deleted views, append new ones.
  if (initialViews !== prevInitialViews) {
    setPrevInitialViews(initialViews);
    setViews((current) => {
      const fresh = new Map(initialViews.map((view) => [view.id, view]));
      const kept = current.flatMap((view) => {
        const next = fresh.get(view.id);
        fresh.delete(view.id);
        return next ? [next] : [];
      });
      return [...kept, ...fresh.values()];
    });
  }

  const moveView = (id: string, toIndex: number) => {
    setViews((current) => {
      const from = current.findIndex((view) => view.id === id);
      if (
        from === -1 ||
        toIndex < 0 ||
        toIndex >= current.length ||
        from === toIndex
      ) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleOpenCreate = () => {
    setSelectedView(null);
    setIsFormDialogOpen(true);
  };

  const handleOpenEdit = (view: SavedView) => {
    setSelectedView(view);
    setIsFormDialogOpen(true);
  };

  const handleOpenDelete = (view: SavedView) => {
    setSelectedView(view);
    setIsDeleteDialogOpen(true);
  };

  return (
    <div className="h-full bg-slate-50/50 p-4 sm:p-8 font-sans text-slate-700">
      <div className="max-w mx-auto space-y-6">
        <div className="flex justify-between items-start gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Saved views</h1>
            <p className="text-xs text-slate-500 mt-1">
              Shared filters your team works from. Order sets the tab order on
              the queue.
            </p>
          </div>
          <button
            onClick={handleOpenCreate}
            className="shrink-0 px-4 py-3 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            New view
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          {views.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No saved views created yet. Click &quot;New view&quot; to create
              one.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50/80 border-b border-slate-200/80">
                  <tr className="text-left text-xs font-medium text-slate-500">
                    <th className="w-12 pl-6 pr-2 py-4 font-medium">#</th>
                    <th className="w-10 px-2 py-4">
                      <span className="sr-only">Shared</span>
                    </th>
                    <th className="px-4 py-4 font-medium">View name</th>
                    <th className="px-4 py-4 font-medium">Tickets</th>
                    <th className="px-4 py-4 font-medium">Last updated</th>
                    <th className="pl-4 pr-6 py-4 font-medium text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {views.map((view, index) => {
                    // filter comes pre-normalised from the service, so legacy
                    // rows and current ones build the same link.
                    const filter =
                      view.filter ?? normalizeFilter(view.filter_json);
                    const query = filterToSearchParams(filter).toString();

                    const targetUrl = query
                      ? `/${tenant}/tickets?${query}`
                      : `/${tenant}/tickets`;

                    const count = view.ticketCount ?? 0;
                    const updated =
                      formatRelativeTime(
                        view.updated_at ?? view.created_at,
                        now,
                      ) ?? "—";

                    // saved_views_update / _delete are owner-only, so a
                    // colleague's shared view offers no actions that would
                    // just fail.
                    const canManage = view.isOwn !== false;

                    return (
                      <tr
                        key={view.id}
                        // Only draggable while the handle is held, so dragging
                        // the name or "Open" still drags a link as usual.
                        draggable={armedId === view.id}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", view.id);
                          setDraggingId(view.id);
                        }}
                        onDragOver={(event) => {
                          if (!draggingId) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          if (draggingId !== view.id) {
                            moveView(draggingId, index);
                          }
                        }}
                        onDrop={(event) => event.preventDefault()}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setArmedId(null);
                        }}
                        className={
                          draggingId === view.id
                            ? "bg-teal-50/60 opacity-60"
                            : "hover:bg-slate-50/50 transition-colors"
                        }
                      >
                        <td className="pl-6 pr-2 py-4">
                          <button
                            type="button"
                            aria-label={`Reorder ${view.name}. Use the up and down arrow keys to move it.`}
                            onPointerDown={() => setArmedId(view.id)}
                            onPointerUp={() => setArmedId(null)}
                            onKeyDown={(event) => {
                              if (event.key === "ArrowUp") {
                                event.preventDefault();
                                moveView(view.id, index - 1);
                              } else if (event.key === "ArrowDown") {
                                event.preventDefault();
                                moveView(view.id, index + 1);
                              }
                            }}
                            className="flex size-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                          >
                            <GripVertical aria-hidden className="size-4" />
                          </button>
                        </td>
                        <td className="px-2 py-4">
                          <Bookmark
                            aria-label={view.is_shared ? "Shared" : "Private"}
                            className={
                              view.is_shared
                                ? "size-5 fill-teal-700 text-teal-700"
                                : "size-5 text-slate-500"
                            }
                          />
                        </td>
                        <td className="px-4 py-4 max-w-xs">
                          <Link
                            href={targetUrl}
                            className="font-bold text-slate-900 hover:text-teal-800 transition-colors"
                          >
                            {view.name}
                          </Link>
                          {/* A name like "Triage" says nothing on its own. */}
                          <p
                            className="mt-0.5 text-xs text-slate-400 truncate"
                            title={describeFilter(filter)}
                          >
                            {describeFilter(filter)}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1.5 text-xs text-slate-500 whitespace-nowrap">
                            <span className="font-bold text-slate-700 mr-1">
                              {count}
                            </span>
                            {count === 1 ? "ticket" : "tickets"}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-xs text-slate-500 whitespace-nowrap">
                          {updated}
                        </td>
                        <td className="pl-4 pr-6 py-4">
                          <div className="flex items-center justify-end gap-4">
                            <Link
                              href={targetUrl}
                              className="text-xs font-bold text-teal-800 hover:text-teal-900 transition-colors"
                            >
                              Open
                            </Link>
                            {canManage ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Actions for ${view.name}`}
                                    className="size-8 rounded-lg text-slate-700 hover:bg-muted"
                                  >
                                    <MoreVertical />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  className="w-40"
                                >
                                  <DropdownMenuItem
                                    onSelect={() => handleOpenEdit(view)}
                                    className="p-2 cursor-pointer"
                                  >
                                    <Edit2 />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={() => handleOpenDelete(view)}
                                    className="p-2 cursor-pointer"
                                  >
                                    <Trash2 />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : (
                              // Keeps "Open" aligned with the rows that do
                              // have a menu.
                              <span aria-hidden className="size-8" />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {isFormDialogOpen && (
          <CreateSavedViewDialog
            key={selectedView?.id ?? "new"}
            open={isFormDialogOpen}
            onOpenChange={setIsFormDialogOpen}
            tenant={tenant}
            view={selectedView}
          />
        )}

        <DeleteSavedViewDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          tenant={tenant}
          view={selectedView}
        />
      </div>
    </div>
  );
}
