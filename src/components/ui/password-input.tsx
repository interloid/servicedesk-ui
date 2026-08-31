"use client";

import * as React from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PasswordInputProps = React.ComponentProps<"input">;

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, disabled, ...props }, ref) => {
    const [showPassword, setShowPassword] = React.useState(false);

    return (
      <div className="relative">
        <Input
          ref={ref}
          type={showPassword ? "text" : "password"}
          disabled={disabled}
          className={cn("pr-10", className)}
          {...props}
        />

        <button
          type="button"
          disabled={disabled}
          aria-label={showPassword ? "Hide password" : "Show password"}
          className="absolute right-3 top-1/2 -translate-y-1/2 border-0 bg-transparent p-0 text-muted-foreground outline-none hover:bg-transparent"
          onClick={() => setShowPassword((prev) => !prev)}
        >
          {showPassword ? (
            <EyeIcon className="h-4 w-4" aria-hidden="true" />
          ) : (
            <EyeOffIcon className="h-4 w-4" aria-hidden="true" />
          )}

          <span className="sr-only">
            {showPassword ? "Hide password" : "Show password"}
          </span>
        </button>
      </div>
    );
  },
);

PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
