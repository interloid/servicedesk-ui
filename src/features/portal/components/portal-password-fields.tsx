"use client";

import { CheckCircle2 } from "lucide-react";
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
 * Mirrors portalSetPasswordSchema. The schema is the rule; this is only what the
 * confirm tick waits for, so a password that cannot be submitted yet does not
 * show as matching. Keep the two in step if the rule ever changes.
 */
const MEETS_RULES = (value: string) => value.length >= 8 && /\d/.test(value);

/** Shown in both fields: what a password looks like before there is one. */
const DOTS = "••••••••••";

/**
 * The two password inputs, shared by the standalone /portal/password page and by
 * the password dialog in the account menu.
 *
 * Extracted rather than written twice because these two fields are the whole
 * point of the screen and drift is expensive here: if the confirm field were
 * given a different autoComplete, or the "8 characters and a number" rule were
 * dropped from one copy, the two ways of setting a password would start
 * disagreeing about what a valid password is.
 *
 * There is no requirements checklist. Both callers used to have a choice about
 * one, and the page took it: three lines of wall between the two fields and the
 * button, on a form whose remaining content is two inputs and a note. The rule
 * lives in portalSetPasswordSchema and comes back as the field's own error
 * message when it is not met, which says the same thing without standing in the
 * way of a customer who already knows how to type a password. So both fields
 * carry dots as their placeholder and neither spends a line stating the rule.
 */
export function PortalPasswordFields({
  control,
}: {
  control: Control<PortalSetPasswordValues>;
}) {
  const [password = "", confirmPassword = ""] = useWatch({
    control,
    name: ["password", "confirmPassword"],
  });

  const matches =
    MEETS_RULES(password) &&
    confirmPassword.length > 0 &&
    confirmPassword === password;

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
                placeholder={DOTS}
                className={FIELD_CLASS}
              />
            </FormControl>

            <FormMessage />
          </FormItem>
        )}
      />

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
                  placeholder={DOTS}
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
