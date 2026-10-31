"use client";

import { use, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { SavedViewTab } from "@/features/saved-view/filters";

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}

function TabButton({ active, onClick, disabled, children }: TabButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={`h-8 whitespace-nowrap border ${
        active
          ? "border-transparent bg-brand-accent font-semibold text-primary-foreground hover:bg-brand-hover hover:text-primary-foreground"
          : "border-transparent bg-white text-slate-500 hover:text-slate-800"
      }`}
    >
      {children}
    </Button>
  );
}

/**
 * Stands in when the saved views couldn't be loaded (an error, or a database
 * without the saved-view migrations): the queue with no view, no count.
 */
const FALLBACK_ALL_TAB: SavedViewTab = {
  id: "all",
  name: "All tickets",
  count: 0,
  isAll: true,
};

const TAB_BAR_CLASS =
  "flex items-center space-x-1 overflow-x-auto border-b border-slate-200 pb-3 text-xs font-medium scrollbar-none";

/** While the tabs stream in; the table above and below is already live. */
export function TicketViewTabsSkeleton() {
  return (
    <div className={TAB_BAR_CLASS}>
      <Skeleton className="h-8 w-24 rounded-md" />
      <Skeleton className="h-8 w-28 rounded-md" />
      <Skeleton className="h-8 w-24 rounded-md" />
    </div>
  );
}

/**
 * The viewer's saved views as tabs. `tabs` is the page's unawaited fetch (one
 * count query per view), read here inside a Suspense boundary so the table
 * never waits on it.
 */
export function TicketViewTabs({
  tabs,
  activeViewId,
  onOpen,
  disabled = false,
}: {
  tabs: Promise<SavedViewTab[]>;
  /** ?view=; none is the "All tickets" tab. */
  activeViewId: string | null;
  onOpen: (tab: SavedViewTab) => void;
  /** An empty queue: the tabs show, but there is nothing to switch to. */
  disabled?: boolean;
}) {
  const loaded = use(tabs);
  const fallback = loaded.length === 0;
  const shown = fallback ? [FALLBACK_ALL_TAB] : loaded;

  return (
    <div className={TAB_BAR_CLASS}>
      {shown.map((tab) => {
        const active = activeViewId ? tab.id === activeViewId : tab.isAll;

        return (
          <TabButton
            key={tab.id}
            active={active}
            onClick={() => onOpen(tab)}
            disabled={disabled}
          >
            {tab.name}
            {!fallback && (
              <Badge
                className={`ml-1 rounded-full px-1.5 py-0 text-[10px] ${
                  active
                    ? "border-0 bg-primary-foreground/20 text-primary-foreground"
                    : "border-0 bg-brand-accent text-brand-accent-foreground"
                }`}
              >
                {tab.count}
              </Badge>
            )}
          </TabButton>
        );
      })}
    </div>
  );
}
