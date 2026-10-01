"use client";

import { Check, CheckCircle2, Info } from "lucide-react";
import { useWatch, type Control } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import type { PortalSetPasswordValues } from "@/features/portal/schemas/portal.schema";
import { cn } from "@/lib/utils";

const FIELD_CLASS = "h-11 rounded-lg bg-background/60 text-sm";

/**
 * Mirrors portalSetPasswordSchema. The schema is still the rule -- this list
 * only shows progress against it as the customer types, so keep the two in
 * step if the rule ever changes.
 */
const REQUIREMENTS = [
  {
    label: "At least 10 characters",
    test: (value: string) => value.length >= 10,
  },
  { label: "At least one number", test: (value: string) => /\d/.test(value) },
];

/**
 * The two password inputs, shared by the standalone /portal/password page and by
 * the password dialog in the account menu.
 *
 * Extracted rather than written twice because these two fields are the whole
 * point of the screen and drift is expensive here: if the confirm field were
 * given a different autoComplete, or the "10 characters and a number" rule
 * were dropped from one copy, the two ways of setting a password would start
 * disagreeing about what a valid password is. The rule is stated once, next to
 * the input that enforces it, and read by both.
 *
 * showRequirements is the difference between the two callers. The page is
 * someone's first password and needs the checklist in front of them. The dialog
 * is someone who already has one and came to change it: there the checklist was
 * three lines of wall between the fields and the button, so they get a dotted
 * placeholder instead and the rule lives only in the schema. The rule is still
 * enforced either way, so a too-short password comes back the same on both.
 */
export function PortalPasswordFields({
  control,
  showRequirements = true,
}: {
  control: Control<PortalSetPasswordValues>;
  showRequirements?: boolean;
}) {
  const [password = "", confirmPassword = ""] = useWatch({
    control,
    name: ["password", "confirmPassword"],
  });

  const meetsRules = REQUIREMENTS.every(({ test }) => test(password));
  const matches =
    meetsRules && confirmPassword.length > 0 && confirmPassword === password;

  return (
    <>
      <FormField
        control={control}
        name="password"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-sm font-semibold text-foreground">
              Password
            </FormLabel>

            <FormControl>
              <PasswordInput
                {...field}
                autoComplete="new-password"
                aria-describedby={
                  showRequirements ? "portal-password-rules" : undefined
                }
                placeholder={
                  showRequirements
                    ? "At least 10 characters, with a number"
                    : "••••••••••"
                }
                className={FIELD_CLASS}
              />
            </FormControl>

            <FormMessage />
          </FormItem>
        )}
      />

      {showRequirements ? (
        <div
          id="portal-password-rules"
          className="rounded-xl border bg-muted/40 px-4 py-3.5"
        >
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            Password requirements
            <Info aria-hidden className="size-3.5 text-muted-foreground" />
          </p>

          <ul className="mt-2.5 flex flex-col gap-2">
            {REQUIREMENTS.map(({ label, test }) => {
              const met = test(password);

              return (
                <li
                  key={label}
                  className={cn(
                    "flex items-center gap-2 text-xs transition-colors",
                    met ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full transition-colors",
                      met
                        ? "bg-success text-white"
                        : "border border-input bg-card",
                    )}
                  >
                    {met ? (
                      <Check className="size-2.5" strokeWidth={3.5} />
                    ) : null}
                  </span>
                  {label}
                  <span className="sr-only">
                    {met ? "(met)" : "(not met yet)"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <FormField
        control={control}
        name="confirmPassword"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-sm font-semibold text-foreground">
              Confirm password
            </FormLabel>

            {/* The tick sits inside the input, left of the show/hide eye, so
                both fields keep the same width. */}
            <div className="relative">
              <FormControl>
                <PasswordInput
                  {...field}
                  autoComplete="new-password"
                  placeholder={
                    showRequirements ? "Type it again" : "••••••••••"
                  }
                  className={cn(FIELD_CLASS, matches && "pr-16")}
                />
              </FormControl>

              {matches ? (
                <span className="pointer-events-none absolute top-1/2 right-10 flex -translate-y-1/2">
                  <CheckCircle2
                    aria-hidden
                    className="size-4.5 fill-success text-white"
                  />
                  <span className="sr-only">Passwords match</span>
                </span>
              ) : null}
            </div>

            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
