"use client";

import { UserShield } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  TEAM_DIALOG_CONTENT,
  TEAM_DIALOG_FOOTER,
  TEAM_DIALOG_TITLE,
  TEAM_MODAL_BUTTON,
} from "@/features/team/components/modal-buttons";
import {
  TEAM_PERMISSION_AREAS,
  TEAM_PERMISSION_AREA_LABELS,
  TEAM_PERMISSION_MATRIX,
  TEAM_ROLE_SUMMARIES,
  TEAM_ROLE_VALUES,
} from "@/features/team/types/team";

/**
 * Values are plain text. Glyphs beside "Full" and "None" only ever decorated
 * two of the six values, so a column read as a ragged mix of icon-then-word
 * and word-alone; colour carries the same meaning without the ragged edge.
 */
function PermissionValue({ value }: { value: string }) {
  const tone =
    value === "None"
      ? "text-muted-foreground"
      : value === "Full"
        ? "font-semibold text-emerald-700 dark:text-emerald-400"
        : "font-medium text-secondary-foreground";

  return <span className={tone}>{value}</span>;
}

export function PermissionMatrixModal() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-10 gap-2 bg-white rounded-lg px-4 text-sm font-semibold shadow-none"
        >
          <UserShield className="size-4" aria-hidden />
          View permissions
        </Button>
      </DialogTrigger>

      <DialogContent className={`sm:max-w-3xl ${TEAM_DIALOG_CONTENT}`}>
        <DialogHeader className="pr-6">
          <DialogTitle className={TEAM_DIALOG_TITLE}>
            Permission matrix
          </DialogTitle>
          <DialogDescription>
            What each role can see and change inside the workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="border-border bg-muted/40 hover:bg-muted/40">
                <TableHead className="h-10 w-[34%] px-4 text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
                  Role
                </TableHead>
                {TEAM_PERMISSION_AREAS.map((area) => (
                  <TableHead
                    key={area}
                    className="h-10 w-[16.5%] px-4 text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase"
                  >
                    {TEAM_PERMISSION_AREA_LABELS[area]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>

            <TableBody>
              {TEAM_ROLE_VALUES.map((role) => {
                const row = TEAM_PERMISSION_MATRIX[role];
                return (
                  <TableRow key={role} className="border-muted">
                    <TableCell className="px-4 py-3 align-middle">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-semibold whitespace-nowrap">
                          {role}
                        </span>
                        <span className="text-xs whitespace-normal text-muted-foreground">
                          {TEAM_ROLE_SUMMARIES[role]}
                        </span>
                      </div>
                    </TableCell>
                    {TEAM_PERMISSION_AREAS.map((area) => (
                      <TableCell
                        key={area}
                        className="px-4 py-3 align-middle text-sm"
                      >
                        <PermissionValue value={row[area]} />
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className={TEAM_DIALOG_FOOTER}>
          <DialogClose asChild>
            <Button variant="outline" size="sm" className={TEAM_MODAL_BUTTON}>
              Done
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
