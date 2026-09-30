"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CircleAlert,
  Loader2,
  LockKeyhole,
  Mail,
  UserPlus,
} from "lucide-react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  passwordSignInAction,
  requestSignInLinkAction,
} from "@/features/portal/actions/portal.actions";
import { PortalSplit } from "@/features/portal/components/portal-split";
import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";
import { applyFieldErrors } from "@/features/portal/form-errors";
import { portalToastResult } from "@/features/portal/portal-toast";
import {
  portalEmailSchema,
  portalPasswordLoginSchema,
  type PortalEmailValues,
  type PortalPasswordLoginValues,
} from "@/features/portal/schemas/portal.schema";

const FIELD_CLASS = "h-11 rounded-lg bg-background/60 text-sm";

const SWITCH_CLASS =
  "w-fit rounded-md text-sm font-semibold text-brand-ink underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none";

type Mode = "link" | "password";

export function PortalSignInForm({
  tenantSlug,
  initialMode = "link",
  initialError,
}: {
  tenantSlug: string;
  initialMode?: Mode;
  initialError?: string;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [banner, setBanner] = useState<string | undefined>(initialError);

  function switchTo(next: Mode) {
    setBanner(undefined);
    setMode(next);
  }

  const isLink = mode === "link";
  const Icon = isLink ? Mail : LockKeyhole;

  return (
    <PortalSplit>
      <span
        aria-hidden
        className="flex size-11 items-center justify-center rounded-xl bg-brand-accent/10 text-brand-accent"
      >
        <Icon className="size-5" />
      </span>

      <div className="mt-4 flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-balance text-foreground">
          {isLink ? "Track your requests" : "Sign in to your account"}
        </h1>
        <p className="text-sm leading-[1.6] text-muted-foreground">
          {isLink
            ? "Use the email you contact us from. We'll send a sign-in link - no password needed."
            : "Use the email you contact us from, and the password you set here."}
        </p>
      </div>

      {banner ? (
        <Alert
          variant="destructive"
          className="mt-4 rounded-[10px] px-3.5 py-3"
        >
          <CircleAlert className="size-4.5" aria-hidden />
          <AlertDescription className="text-sm leading-[1.55]">
            {banner}
          </AlertDescription>
        </Alert>
      ) : null}

      {isLink ? (
        <MagicLinkForm
          tenantSlug={tenantSlug}
          onError={setBanner}
          onSwitch={() => switchTo("password")}
        />
      ) : (
        <PasswordForm
          tenantSlug={tenantSlug}
          onError={setBanner}
          onSwitch={() => switchTo("link")}
        />
      )}

      {/* Both modes. Someone who chose a password is as likely to be arriving
          for the first time as someone who asked for a link, and the note is
          the only thing on the card that says no account is needed at all. */}
      <FirstTimeNote tenantSlug={tenantSlug} />
    </PortalSplit>
  );
}

function MagicLinkForm({
  tenantSlug,
  onError,
  onSwitch,
}: {
  tenantSlug: string;
  onError: (message?: string) => void;
  onSwitch: () => void;
}) {
  const router = useRouter();

  const form = useForm<PortalEmailValues>({
    defaultValues: { email: "" },
    resolver: zodResolver(portalEmailSchema),
  });

  async function onSubmit(values: PortalEmailValues) {
    onError(undefined);

    const result = await requestSignInLinkAction(tenantSlug, values);

    if (result.success) {
      // No success toast: this navigates to the "check your inbox" screen,
      // which exists to say exactly that, and a toast on top of it says it
      // twice.
      router.push(
        `${portalPath(tenantSlug, PORTAL_ROUTES.CHECK_EMAIL)}?email=${encodeURIComponent(
          result.data.email,
        )}`,
      );

      return;
    }

    applyFieldErrors(form, result.fieldErrors);
    onError(result.message);
    portalToastResult(result);
  }

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="mt-5 flex flex-col gap-4"
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-semibold text-foreground">
                Email address
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@company.com"
                  className={FIELD_CLASS}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          size="lg"
          className="h-11 w-full px-5 font-semibold sm:w-fit"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? (
            <>
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Sending…
            </>
          ) : (
            "Email me a sign-in link"
          )}
        </Button>

        <Divider />

        <button type="button" onClick={onSwitch} className={SWITCH_CLASS}>
          Sign in with a password instead
        </button>
      </form>
    </Form>
  );
}

function PasswordForm({
  tenantSlug,
  onError,
  onSwitch,
}: {
  tenantSlug: string;
  onError: (message?: string) => void;
  onSwitch: () => void;
}) {
  const router = useRouter();

  const form = useForm<PortalPasswordLoginValues>({
    defaultValues: { email: "", password: "" },
    resolver: zodResolver(portalPasswordLoginSchema),
  });

  async function onSubmit(values: PortalPasswordLoginValues) {
    onError(undefined);

    const result = await passwordSignInAction(tenantSlug, values);

    if (result.success) {
      // Same as the magic link above: the next screen is the confirmation, and
      // if the password was wrong the sign-in screen itself stays put.
      router.replace(result.data.redirectTo);
      return;
    }

    applyFieldErrors(form, result.fieldErrors);
    onError(result.message);
    portalToastResult(result);
  }

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="mt-5 flex flex-col gap-4"
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-semibold text-foreground">
                Email address
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@company.com"
                  className={FIELD_CLASS}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"

          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-semibold text-foreground">
                Password
              </FormLabel>
              <FormControl>
                <PasswordInput
                  {...field}
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  className={FIELD_CLASS}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          size="lg"
          className="h-11 w-full px-6 font-semibold sm:w-fit"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? (
            <>
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </Button>

        <Divider />

        {/* No "Forgot password?" link: there is no reset-by-email flow. A
            customer who has lost their password gets back in with a sign-in
            link, and can set a new one from there once they are in. */}
        <button type="button" onClick={onSwitch} className={SWITCH_CLASS}>
          Use a sign-in link instead
        </button>
      </form>
    </Form>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3" aria-hidden>
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground">or</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function FirstTimeNote({ tenantSlug }: { tenantSlug: string }) {
  return (
    <div className="mt-6 rounded-xl border bg-muted/40 p-4">
      <p className="flex items-center gap-2.5 text-sm font-semibold text-foreground">
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-card text-brand-accent shadow-xs"
        >
          <UserPlus className="size-4" />
        </span>
        First time here?
      </p>

      <p className="mt-2.5 text-xs leading-5 text-muted-foreground">
        You don&apos;t need an account to reach us.{" "}
        <Link
          href={portalPath(tenantSlug, PORTAL_ROUTES.NEW_REQUEST)}
          className="font-semibold text-brand-ink underline-offset-4 hover:text-brand-ink hover:underline"
        >
          Submit a request
        </Link>{" "}
        and we&apos;ll set one up from your email.
      </p>
    </div>
  );
}
