"use client";

import { Children, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bookmark,
  Edit2,
  GripVertical,
  Info,
  MoreVertical,
  Plus,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IconTile } from "@/features/billing/components/reuse";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CUSTOM_VIEWS_PER_USER_MAX,
  describeView,
  normalizeFilter,
} from "../filters";
import type { SavedView } from "../services/saved-views.service";
import { reorderSavedViewsAction } from "../actions/saved-views.actions";
import CreateSavedViewDialog from "./create-saved-view-dialog";
import DeleteSavedViewDialog from "./delete-saved-view-dialog";
import { ROW_GRID } from "./row-grid";

interface SavedViewsListProps {
  initialViews: SavedView[];
  tenant: string;
  /** Server render time, so "2 hours ago" matches on hydration. */
  now: number;
  /** Custom views (create, edit, share) are Pro; the four built-ins are not. */
  isPro: boolean;
}

type Section = "system" | "custom";

const SAVE_DELAY_MS = 400;

/** Rows a section shows before its list scrolls. */
const VISIBLE_ROWS_MAX = 5;

/** How close to the list's edge a drag starts scrolling it, and how fast. */
const DRAG_SCROLL_EDGE_PX = 40;
const DRAG_SCROLL_STEP_PX = 12;

function sectionOf(view: SavedView): Section {
  return view.isSystem ? "system" : "custom";
}

/** Move `id` to `toIndex` within its own section, leaving the other untouched. */
function moveWithinSection(
  views: SavedView[],
  id: string,
  toIndex: number,
): SavedView[] {
  const moving = views.find((view) => view.id === id);
  if (!moving) return views;

  const section = sectionOf(moving);
  const members = views.filter((view) => sectionOf(view) === section);
  const from = members.findIndex((view) => view.id === id);
  const to = Math.max(0, Math.min(members.length - 1, toIndex));
  if (from === to) return views;

  const reordered = [...members];
  reordered.splice(from, 1);
  reordered.splice(to, 0, moving);

  // Built-in views always lead, so the stored positions follow the screen.
  const system =
    section === "system" ? reordered : views.filter((v) => v.isSystem);
  const custom =
    section === "custom" ? reordered : views.filter((v) => !v.isSystem);
  return [...system, ...custom];
}

/**
 * saved_views_update / _delete are owner-only and never touch built-in views,
 * so anything else offers no actions that would just fail.
 */
function canManageView(view: SavedView): boolean {
  return view.isOwn && !view.isSystem;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export default function SavedViewsList({
  initialViews = [],
  tenant,
  now,
  isPro,
}: SavedViewsListProps) {
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedView, setSelectedView] = useState<SavedView | null>(null);

  const [views, setViews] = useState(initialViews);
  const [prevInitialViews, setPrevInitialViews] = useState(initialViews);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  /** The order the server last accepted; a failed save falls back to it. */
  const savedOrder = useRef(initialViews.map((view) => view.id));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** An order waiting on the timer; sent at once if the page closes first. */
  const pendingOrder = useRef<string[] | null>(null);

  // A create/edit/delete refreshes the page and hands down a new list. Keep
  // the order on screen, drop deleted views, and add new ones at the end of
  // their section.
  if (initialViews !== prevInitialViews) {
    setPrevInitialViews(initialViews);
    setViews((current) => {
      const fresh = new Map(initialViews.map((view) => [view.id, view]));
      const kept = current.flatMap((view) => {
        const next = fresh.get(view.id);
        fresh.delete(view.id);
        return next ? [next] : [];
      });
      const merged = [...kept, ...fresh.values()];
      return [
        ...merged.filter((view) => view.isSystem),
        ...merged.filter((view) => !view.isSystem),
      ];
    });
  }

  const ids = views.map((view) => view.id);
  const idsKey = ids.join(",");

  // Save once the order settles: after a drop, or a pause in arrow-key moves.
  useEffect(() => {
    if (draggingId) return;

    const order = idsKey ? idsKey.split(",") : [];
    if (order.length === 0 || sameOrder(order, savedOrder.current)) return;
    // A view was added or removed, not moved: nothing of the user's to save.
    if (
      order.length !== savedOrder.current.length ||
      !order.every((id) => savedOrder.current.includes(id))
    ) {
      savedOrder.current = order;
      return;
    }

    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingOrder.current = order;
    saveTimer.current = setTimeout(async () => {
      pendingOrder.current = null;
      const res = await reorderSavedViewsAction(tenant, order);
      if (res.success) {
        savedOrder.current = order;
        return;
      }

      toast.error(res.error || "Couldn't save the new order.");
      const rank = new Map(savedOrder.current.map((id, i) => [id, i]));
      setViews((current) =>
        [...current].sort(
          (a, b) =>
            (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        ),
      );
    }, SAVE_DELAY_MS);
  }, [idsKey, draggingId, tenant]);

  // Drag a view to the top and click its Open straight away, and the page
  // unmounts inside the save delay: send the order now rather than drop it.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (pendingOrder.current) {
        void reorderSavedViewsAction(tenant, pendingOrder.current);
        pendingOrder.current = null;
      }
    },
    [tenant],
  );

  const systemViews = views.filter((view) => view.isSystem);
  const customViews = views.filter((view) => !view.isSystem);
  const ownCustomCount = customViews.filter((view) => view.isOwn).length;
  const atViewLimit = ownCustomCount >= CUSTOM_VIEWS_PER_USER_MAX;

  const announceMove = (view: SavedView, index: number, total: number) => {
    setAnnouncement(`${view.name} moved to position ${index + 1} of ${total}.`);
  };

  const moveTo = (view: SavedView, toIndex: number) => {
    const members = sectionOf(view) === "system" ? systemViews : customViews;
    const clamped = Math.max(0, Math.min(members.length - 1, toIndex));
    if (members[clamped]?.id === view.id) return;
    setViews((current) => moveWithinSection(current, view.id, toIndex));
    announceMove(view, clamped, members.length);
  };

  /**
   * Pointer-driven so it works the same with a mouse, a pen and a finger;
   * HTML5 drag-and-drop never fires on touch screens. The handle captures the
   * pointer, and the row moves to wherever the pointer sits among the
   * section's other rows.
   */
  const dragHandlers = (view: SavedView) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraggingId(view.id);
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (draggingId !== view.id) return;

      const members = sectionOf(view) === "system" ? systemViews : customViews;
      // Rows are found through the DOM: the section's list holds exactly
      // this section's rows, in screen order.
      const list = event.currentTarget.closest("ul");
      // The list scrolls past five rows: nudge it when the pointer nears an
      // edge so a row can be dragged to a place that's scrolled out of view.
      if (list) {
        const bounds = list.getBoundingClientRect();
        if (event.clientY < bounds.top + DRAG_SCROLL_EDGE_PX) {
          list.scrollTop -= DRAG_SCROLL_STEP_PX;
        } else if (event.clientY > bounds.bottom - DRAG_SCROLL_EDGE_PX) {
          list.scrollTop += DRAG_SCROLL_STEP_PX;
        }
      }
      const rows = list?.querySelectorAll<HTMLElement>("[data-view-id]") ?? [];
      let target = 0;
      for (const row of rows) {
        if (row.dataset.viewId === view.id) continue;
        const rect = row.getBoundingClientRect();
        if (event.clientY > rect.top + rect.height / 2) target += 1;
      }

      const from = members.findIndex((member) => member.id === view.id);
      if (target !== from) {
        setViews((current) => moveWithinSection(current, view.id, target));
      }
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (draggingId !== view.id) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      setDraggingId(null);
      const members = sectionOf(view) === "system" ? systemViews : customViews;
      const index = members.findIndex((member) => member.id === view.id);
      announceMove(view, index, members.length);
    },
    onPointerCancel: () => setDraggingId(null),
    onLostPointerCapture: () => setDraggingId(null),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const members = sectionOf(view) === "system" ? systemViews : customViews;
      const index = members.findIndex((member) => member.id === view.id);

      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveTo(view, index - 1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        moveTo(view, index + 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        moveTo(view, 0);
      } else if (event.key === "End") {
        event.preventDefault();
        moveTo(view, members.length - 1);
      } else {
        return;
      }

      // The list may scroll: keep the moved row in sight once it re-renders.
      const handle = event.currentTarget;
      requestAnimationFrame(() =>
        handle.closest("li")?.scrollIntoView({ block: "nearest" }),
      );
    },
  });

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

  const plansHref = `/${tenant}/account/plans`;

  // Numbers run on across both sections, as the ticket page tabs do.
  const renderRows = (list: SavedView[], numberFrom = 1) => {
    // Rows without a menu keep its space only when another row in the
    // section has one; otherwise "Open" sits flush right under "Actions".
    const sectionHasMenu = list.some(canManageView);
    return list.map((view, index) => (
      <ViewRow
        key={view.id}
        view={view}
        index={index}
        order={numberFrom + index}
        total={list.length}
        tenant={tenant}
        now={now}
        isPro={isPro}
        isDragging={draggingId === view.id}
        reserveMenuSpace={sectionHasMenu}
        handle={dragHandlers(view)}
        onMove={(to) => moveTo(view, to)}
        onEdit={() => handleOpenEdit(view)}
        onDelete={() => handleOpenDelete(view)}
      />
    ));
  };

  return (
    <TooltipProvider>
      <div className="h-full bg-slate-50/50 px-4 py-5 font-sans text-slate-700 sm:p-6 lg:p-8">
        <div className="mx-auto flex flex-col gap-5 sm:gap-6">
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                  Saved views
                </h1>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Your saved filters for the ticket queue.
                {isPro ? (
                  <>
                    {" "}
                    <span
                      className={cn(
                        "font-medium",
                        atViewLimit ? "text-slate-700" : "text-slate-500",
                      )}
                    >
                      {ownCustomCount} of {CUSTOM_VIEWS_PER_USER_MAX} custom
                      views used.
                    </span>
                  </>
                ) : null}
              </p>
            </div>

            {isPro && atViewLimit ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="w-full shrink-0 sm:w-auto">
                    <Button
                      disabled
                      aria-label={`New view — limit of ${CUSTOM_VIEWS_PER_USER_MAX} reached`}
                      className="h-10 w-full gap-1.5 rounded-lg bg-brand-accent px-4 text-sm font-semibold text-brand-accent-foreground shadow-sm sm:w-auto"
                    >
                      <Plus className="size-4" />
                      New view
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end" className="max-w-56">
                  You can have up to {CUSTOM_VIEWS_PER_USER_MAX} custom views.
                  Delete one to add another.
                </TooltipContent>
              </Tooltip>
            ) : isPro ? (
              <Button
                onClick={handleOpenCreate}
                className="h-10 w-full shrink-0 gap-1.5 rounded-lg bg-brand-accent px-4 text-sm font-semibold text-brand-accent-foreground shadow-sm hover:bg-brand-accent/90 sm:w-auto"
              >
                <Plus className="size-4" />
                New view
              </Button>
            ) : (
              // Not Pro: disabled. The span keeps the tooltip working, since a
              // disabled button fires no pointer events.
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="w-full shrink-0 sm:w-auto">
                    <Button
                      disabled
                      aria-label="New view — requires Pro"
                      className="h-10 w-full gap-1.5 rounded-lg bg-brand-accent px-4 text-sm font-semibold text-brand-accent-foreground shadow-sm sm:w-auto"
                    >
                      <Plus className="size-4" />
                      New view
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end" className="max-w-56">
                  Custom saved views require Pro. Upgrade to unlock.
                </TooltipContent>
              </Tooltip>
            )}
          </header>

          {!isPro ? (
            <div className="flex flex-col gap-2 rounded-xl border border-brand-accent/20 bg-brand-accent/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <p className="flex items-start gap-2.5 text-sm text-slate-700">
                <Info className="mt-0.5 size-4 shrink-0 text-brand-accent" />
                <span>
                  Your four default views are available on every plan.{" "}
                  <Link
                    href={plansHref}
                    className="font-semibold text-brand-accent hover:underline"
                  >
                    Upgrade to Pro
                  </Link>{" "}
                  to create and share custom views.
                </span>
              </p>
              <Link
                href={plansHref}
                className="inline-flex shrink-0 items-center gap-1 self-start pl-6.5 text-sm font-semibold text-brand-accent underline underline-offset-2 hover:text-brand-accent/80 sm:self-auto sm:pl-0"
              >
                Upgrade to Pro
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
          ) : null}

          <ViewSection
            icon={Bookmark}
            tone="teal"
            title="Default views"
            description="These views are built-in and available on every plan."
          >
            {systemViews.length ? (
              renderRows(systemViews)
            ) : (
              <EmptyRow>
                The built-in views haven&apos;t been set up for this workspace
                yet. Refresh in a moment.
              </EmptyRow>
            )}
          </ViewSection>

          <ViewSection
            icon={Users}
            tone="blue"
            title="My and shared views"
            description="Custom views created by you or shared with your team."
          >
            {customViews.length ? (
              renderRows(customViews, systemViews.length + 1)
            ) : isPro ? (
              <EmptyRow>
                <p className="font-semibold text-slate-700">
                  No custom views yet
                </p>
                <p className="mt-1">
                  Save a filter you use often, and share it with your team if it
                  helps them too.
                </p>
                <Button
                  onClick={handleOpenCreate}
                  variant="outline"
                  size="sm"
                  className="mt-3 h-10 gap-1.5 rounded-lg"
                >
                  <Plus className="size-4" />
                  New view
                </Button>
              </EmptyRow>
            ) : (
              <EmptyRow>
                <p className="font-semibold text-slate-700">
                  Custom views are a Pro feature
                </p>
                <p className="mt-1">
                  Filter by any mix of status, priority, assignee and text, then
                  share it with your team.{" "}
                  <Link
                    href={plansHref}
                    className="font-semibold text-brand-accent hover:underline"
                  >
                    See plans
                  </Link>
                </p>
              </EmptyRow>
            )}
          </ViewSection>

          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </div>

        {isFormDialogOpen && (
          <CreateSavedViewDialog
            key={selectedView?.id ?? "new"}
            open={isFormDialogOpen}
            onOpenChange={setIsFormDialogOpen}
            tenant={tenant}
            view={selectedView}
            views={views}
          />
        )}

        <DeleteSavedViewDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          tenant={tenant}
          view={isDeleteDialogOpen ? selectedView : null}
        />
      </div>
    </TooltipProvider>
  );
}

/** Same look as the billing history table. */
function ViewSection({
  icon,
  tone,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  tone: "teal" | "blue";
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [maxHeight, setMaxHeight] = useState<number>();
  // By count, not `children`: that is a new array every render, and a drag
  // re-renders on every pointer move. The observer handles size changes.
  const rowCount = Children.count(children);

  // Five rows, then scroll. Measured rather than fixed: rows wrap to
  // different heights on narrow screens.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const rows = list.children;
      if (rows.length <= VISIBLE_ROWS_MAX) {
        setMaxHeight(undefined);
        return;
      }
      const last = rows[VISIBLE_ROWS_MAX - 1] as HTMLElement;
      setMaxHeight(last.offsetTop + last.offsetHeight);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const row of list.children) observer.observe(row);
    return () => observer.disconnect();
  }, [rowCount]);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <header className="flex items-center gap-3 px-4 py-4 sm:px-6">
        <IconTile icon={icon} tone={tone} />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
      </header>

      <div
        aria-hidden
        className={cn(
          ROW_GRID,
          "hidden h-10 border-y border-slate-100 bg-slate-50 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500 sm:px-6 md:grid",
        )}
      >
        <span />
        <span className="text-center">Order</span>
        <span>View name</span>
        <span>Tickets</span>
        <span>Last updated</span>
        <span className="text-right">Actions</span>
      </div>

      <ul
        ref={listRef}
        style={{ maxHeight }}
        className="relative divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 text-sm md:border-t-0"
      >
        {children}
      </ul>
    </section>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="p-5 text-center text-sm text-slate-500 sm:p-6">
      {children}
    </li>
  );
}

interface ViewRowProps {
  view: SavedView;
  index: number;
  /** The view's place in the whole list, shown in the Order column. */
  order: number;
  total: number;
  tenant: string;
  now: number;
  isPro: boolean;
  isDragging: boolean;
  /** Keep the menu's space so "Open" lines up with rows that have one. */
  reserveMenuSpace: boolean;
  handle: React.ButtonHTMLAttributes<HTMLButtonElement>;
  onMove: (toIndex: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function ViewRow({
  view,
  index,
  order,
  total,
  tenant,
  now,
  isPro,
  isDragging,
  reserveMenuSpace,
  handle,
  onMove,
  onEdit,
  onDelete,
}: ViewRowProps) {
  // filter comes pre-normalised from the service, so legacy rows and current
  // ones build the same link.
  const filter = view.filter ?? normalizeFilter(view.filter_json);
  // By id: AND / OR rules don't fit the queue's status=/priority= params.
  const href = `/${tenant}/tickets?view=${view.id}`;
  const description = describeView({ systemKey: view.systemKey, filter });

  const count = view.ticketCount ?? 0;
  const countLabel = `${count} ${count === 1 ? "ticket" : "tickets"}`;
  const updated = view.isSystem
    ? "Built-in"
    : (formatRelativeTime(view.updated_at ?? view.created_at, now) ?? "—");

  const canManage = canManageView(view);

  return (
    <li
      data-view-id={view.id}
      className={cn(
        ROW_GRID,
        "px-3 py-3.5 sm:px-6 sm:py-4 transition-colors",
        isDragging
          ? "relative z-10 bg-brand-accent/5 shadow-md ring-1 ring-brand-accent/30"
          : "hover:bg-slate-50/60",
      )}
    >
      <button
        type="button"
        {...handle}
        aria-label={`Reorder ${view.name}, position ${index + 1} of ${total}. Use the arrow keys to move it.`}
        className={cn(
          // Phones reorder from the row menu: a grip next to a scrolling list
          // fights the scroll, and the column costs the name its width.
          "hidden size-8 touch-none select-none items-center justify-center justify-self-center rounded-md md:flex text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
          isDragging ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <GripVertical aria-hidden className="size-4" />
      </button>

      {/* The tab position on the ticket page. */}
      <span
        aria-hidden
        className="flex h-8 w-full items-center justify-center rounded-md border border-slate-200/80 bg-slate-100 text-sm font-semibold tabular-nums text-slate-700"
      >
        {order}
      </span>

      {/* Phones wrap the name and summary; the desktop table truncates. */}
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 md:flex-nowrap">
          <Link
            href={href}
            className="min-w-0 wrap-break-word font-medium md:truncate text-slate-900 transition-colors hover:text-brand-accent"
          >
            {view.name}
          </Link>
          {!view.isSystem && view.is_shared && !view.isOwn ? (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
              Team
            </span>
          ) : null}
        </div>
        {/* A name like "Triage" says nothing on its own. */}
        <p
          className="mt-0.5 wrap-break-word text-xs text-slate-500 md:truncate"
          title={description}
        >
          {description}
        </p>
        <p className="mt-1 text-[11px] text-slate-400 md:hidden">
          {countLabel} · {updated}
        </p>
      </div>

      <div className="hidden md:block">
        <span className="inline-flex items-center whitespace-nowrap rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold leading-5 text-slate-600">
          {countLabel}
        </span>
      </div>

      <div className="hidden whitespace-nowrap text-slate-600 md:block">
        {updated}
      </div>

      <div className="flex items-center justify-end gap-1.5 sm:gap-2">
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="h-8 rounded-lg bg-brand-accent/10 px-3 text-xs font-semibold text-brand-accent hover:bg-brand-accent/15 hover:text-brand-accent"
        >
          <Link href={href} aria-label={`Open ${view.name}`}>
            Open
          </Link>
        </Button>

        {/* Every row has a menu on phones, where Move up / down replace the
            drag handle; on desktop only the views the user can edit do. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label={`Actions for ${view.name}`}
              className={cn(
                "size-8 rounded-lg border-slate-200 text-slate-600 shadow-none",
                !canManage && "md:hidden",
              )}
            >
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {canManage ? (
              isPro ? (
                <DropdownMenuItem
                  onSelect={onEdit}
                  className="cursor-pointer p-2"
                >
                  <Edit2 />
                  Edit
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled className="p-2">
                  <Edit2 />
                  Edit
                  <span className="ml-auto text-[10px] font-bold text-slate-400">
                    PRO
                  </span>
                </DropdownMenuItem>
              )
            ) : null}
            <DropdownMenuItem
              disabled={index === 0}
              onSelect={() => onMove(index - 1)}
              className="cursor-pointer p-2 md:hidden"
            >
              <ArrowUp />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === total - 1}
              onSelect={() => onMove(index + 1)}
              className="cursor-pointer p-2 md:hidden"
            >
              <ArrowDown />
              Move down
            </DropdownMenuItem>
            {canManage ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={onDelete}
                  className="cursor-pointer p-2"
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {!canManage && reserveMenuSpace ? (
          // Keeps "Open" aligned with the rows that do have a menu.
          <span aria-hidden className="hidden size-8 md:block" />
        ) : null}
      </div>
    </li>
  );
}
