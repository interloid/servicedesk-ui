"use client";

import {
  useState,
  useTransition,
  useEffect,
  type ComponentType,
  type ReactNode,
} from "react";
import { useRouter, useParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { CircleAlert, CircleCheck, Clock, ShieldX } from "lucide-react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { AuthCard, AuthShell } from "@/features/auth/components/auth-card";
import { createSupabaseClient } from "@/lib/supabase/client";

import {
  UpdatePasswordValues,
  updatePasswordSchema,
} from "@/features/auth/schemas/reset-password";

import {
  checkTenantPasswordAccessAction,
  updateTenantPasswordAction,
} from "@/features/auth/actions/actions";
import { PageLoader } from "@/components/shared/page-loader";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { tenantLoginPath } from "@/lib/tenancy";

const EXPIRED_LINK_MESSAGE =
  "Email links work once and expire after an hour, so this one has either been used or run out. Request a new link and open it from the newest email.";

/** Why the form can't be used at all, as opposed to one bad attempt. */
type BlockedReason = "expired" | "no-access";

/**
 * Invite: Supabase's own invite mail. Magic link: the mail an existing account
 * gets when it's invited to another workspace. Both are a first password, not
 * a reset, and the page says so.
 */
const FIRST_PASSWORD_TYPES = new Set(["invite", "magiclink"]);
const LINK_TYPES = new Set(["invite", "magiclink", "recovery"]);

/** How long the "saved" state shows before it moves on to sign in. */
const REDIRECT_SECONDS = 2;

type StatusTone = "success" | "danger";

const STATUS_TONES: Record<
  StatusTone,
  { circle: string; icon: string; badge: string }
> = {
  success: {
    circle: "bg-emerald-100 dark:bg-emerald-950/50",
    icon: "text-emerald-600 dark:text-emerald-400",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  danger: {
    circle: "bg-destructive/10 dark:bg-destructive/20",
    icon: "text-destructive",
    badge: "border-destructive/30 bg-destructive/5 text-destructive",
  },
};

/**
 * The page's end states -- saved, expired, no access -- laid out like the
 * payment result card: a round icon, a centred title and description, a
 * details box, and the way on in a footer under a divider.
 */
function StatusPanel({
  tone,
  icon: Icon,
  title,
  description,
  email,
  status,
  note,
  footer,
}: {
  tone: StatusTone;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: ReactNode;
  email: string | null;
  status: string;
  note?: ReactNode;
  footer: ReactNode;
}) {
  const styles = STATUS_TONES[tone];

  return (
    <>
      <div className="flex flex-col items-center gap-2 text-center">
        <span
          aria-hidden
          className={cn(
            "mb-2 flex size-16 items-center justify-center rounded-full",
            styles.circle,
          )}
        >
          <Icon className={cn("size-10", styles.icon)} strokeWidth={1.75} />
        </span>

        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h1>

        <p
          role="status"
          className="text-sm leading-[1.6] text-muted-foreground"
        >
          {description}
        </p>
      </div>

      <div className="space-y-3 rounded-lg border bg-muted/50 p-4 text-left">
        {email && (
          <div className="flex items-center justify-between gap-4 text-xs">
            <span className="shrink-0 font-medium text-muted-foreground">
              Account
            </span>
            <span className="truncate font-semibold text-foreground">
              {email}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-4 text-xs">
          <span className="font-medium text-muted-foreground">Status</span>
          <Badge variant="outline" className={styles.badge}>
            {status}
          </Badge>
        </div>
      </div>

      {note && (
        <p className="text-center text-xs text-muted-foreground">{note}</p>
      )}

      <div className="-mx-5 -mb-6 flex flex-col gap-2 rounded-b-2xl border-t bg-muted/50 px-5 py-4 md:-mx-8 md:-mb-8 md:px-8">
        {footer}
      </div>
    </>
  );
}

/** Counts down to the redirect so the move to sign in is expected. */
function RedirectCountdown() {
  const [left, setLeft] = useState(REDIRECT_SECONDS);

  useEffect(() => {
    if (left <= 0) return;
    const tick = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(tick);
  }, [left]);

  return left > 0 ? (
    <>
      Redirecting to the sign-in page in{" "}
      <span className="font-bold text-foreground">{left}</span>{" "}
      {left === 1 ? "second" : "seconds"}…
    </>
  ) : (
    "Opening the sign-in page…"
  );
}

export default function DirectResetPasswordPage() {
  const router = useRouter();

  const params = useParams<{ tenantSlug: string }>();
  const tenantSlug = params.tenantSlug;

  const [isVerifyingSession, setIsVerifyingSession] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState<BlockedReason>("expired");
  const [isFirstPassword, setIsFirstPassword] = useState(false);
  // Who the link signed in as, so a blocked person knows which address to
  // give their admin. Captured before the blocked session is signed out.
  const [linkEmail, setLinkEmail] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm<UpdatePasswordValues>({
    resolver: zodResolver(updatePasswordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    let mounted = true;

    const verifyAuthSession = async () => {
      const supabase = createSupabaseClient();

      try {
        // Supabase sends a dead link back with the reason in the URL
        // (#error=access_denied&error_code=otp_expired, or ?error=… on the
        // code flow) and no tokens. Stop there: falling through to
        // getSession() would pick up whoever is already signed in on this
        // browser and offer to change THEIR password.
        const searchParams = new URLSearchParams(window.location.search);
        const linkParams = new URLSearchParams(
          window.location.hash.substring(1),
        );
        const linkError =
          searchParams.get("error_code") ??
          searchParams.get("error") ??
          linkParams.get("error_code") ??
          linkParams.get("error");

        if (linkError) {
          console.error("[Reset Password] Link rejected:", linkError);

          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );

          if (mounted) {
            setAuthError(EXPIRED_LINK_MESSAGE);
          }

          return;
        }

        const code = searchParams.get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            console.error(
              "[Reset Password] Code exchange failed:",
              error.message,
            );

            if (mounted) {
              setAuthError(EXPIRED_LINK_MESSAGE);
            }

            return;
          }

          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );
        }

        const hash = window.location.hash.substring(1);
        const hashParams = new URLSearchParams(hash);

        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        const type = hashParams.get("type");

        if (type && LINK_TYPES.has(type) && accessToken && refreshToken) {
          if (mounted) {
            setIsFirstPassword(FIRST_PASSWORD_TYPES.has(type));
          }

          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error || !data.session) {
            console.error(
              "[Reset Password] Failed to establish session:",
              error?.message,
            );

            if (mounted) {
              setAuthError(EXPIRED_LINK_MESSAGE);
            }

            return;
          }

          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );
        }

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError || !session) {
          console.error(
            "[Reset Password] No valid session:",
            sessionError?.message,
          );

          if (mounted) {
            setAuthError(EXPIRED_LINK_MESSAGE);
          }

          return;
        }

        if (mounted) {
          setLinkEmail(session.user.email ?? null);
        }

        // The link's session proves who they are, not that they still belong
        // here: a revoked invite or a removed member keeps a working link.
        const access = await checkTenantPasswordAccessAction(tenantSlug);

        if (!access.success) {
          // The server already ended the session; clear this tab's copy too.
          await supabase.auth.signOut({ scope: "local" });

          if (mounted) {
            setBlockedReason(
              access.reason === "no-access" ? "no-access" : "expired",
            );
            setAuthError(access.error);
          }

          return;
        }

        if (mounted) {
          setAuthError(null);
        }
      } catch (error) {
        console.error("[Reset Password] Session verification failed:", error);

        if (mounted) {
          setAuthError(EXPIRED_LINK_MESSAGE);
        }
      } finally {
        if (mounted) {
          setIsVerifyingSession(false);
        }
      }
    };

    verifyAuthSession();

    return () => {
      mounted = false;
    };
  }, [tenantSlug]);

  function onSubmit(values: UpdatePasswordValues) {
    startTransition(async () => {
      form.clearErrors("root");

      try {
        // Saved on the server, which checks the membership again: an admin
        // can revoke the invite while this page sits open.
        const result = await updateTenantPasswordAction(values, tenantSlug);

        if (!result.success) {
          if (result.reason === "retry") {
            form.setError("root", { message: result.error });
            toast.error(result.error);
            return;
          }

          await createSupabaseClient().auth.signOut({ scope: "local" });
          setBlockedReason(result.reason);
          setAuthError(result.error);
          toast.error(result.error);
          return;
        }

        // The server signed the link's session out; clear this tab's copy.
        await createSupabaseClient().auth.signOut({ scope: "local" });

        setUpdated(true);
        toast.success(
          isFirstPassword
            ? "Password set. Sign in to open your workspace."
            : "Password updated. Sign in with your new password.",
        );

        setTimeout(() => {
          router.push(tenantLoginPath(tenantSlug));
        }, REDIRECT_SECONDS * 1000);
      } catch (error) {
        console.error(
          "[Reset Password] Unexpected password update error:",
          error,
        );

        const message =
          "We couldn't update your password. Check your connection and try again.";

        form.setError("root", { message });
        toast.error(message);
      }
    });
  }

  if (isVerifyingSession) {
    return <PageLoader />;
  }

  return (
    <AuthShell>
      <div className="flex h-full w-full items-center justify-center bg-background px-4 py-12">
        <Form {...form}>
          <AuthCard onSubmit={form.handleSubmit(onSubmit)}>
            {updated ? (
              <StatusPanel
                tone="success"
                icon={CircleCheck}
                title={isFirstPassword ? "You're all set" : "Password updated"}
                description={
                  isFirstPassword
                    ? "Your password is saved. Sign in with it to open your workspace."
                    : "Your new password is saved. Use it the next time you sign in."
                }
                email={linkEmail}
                status="Password set"
                note={<RedirectCountdown />}
                footer={
                  // Don't make them wait, and a way on if the redirect stalls.
                  <Button asChild className="h-10 w-full font-semibold">
                    <Link href={tenantLoginPath(tenantSlug)}>
                      Continue to sign in
                    </Link>
                  </Button>
                }
              />
            ) : authError ? (
              // A dead link or revoked access can't be fixed by typing, so
              // the form goes away and the way forward takes its place.
              <StatusPanel
                tone="danger"
                icon={blockedReason === "no-access" ? ShieldX : Clock}
                title={
                  blockedReason === "no-access"
                    ? "Access removed"
                    : "Link expired"
                }
                description={authError}
                email={linkEmail}
                status={
                  blockedReason === "no-access" ? "No access" : "Link expired"
                }
                note={
                  // An invitee has no password yet, so their admin resending
                  // the invite is as good a way back as a reset link.
                  blockedReason === "expired" && isFirstPassword
                    ? "Opening an invitation? Your workspace admin can also resend it from Team & roles."
                    : undefined
                }
                footer={
                  <Button asChild className="h-10 w-full font-semibold">
                    <Link href={tenantLoginPath(tenantSlug)}>
                      Back to sign in
                    </Link>
                  </Button>
                }
              />
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">
                    {isFirstPassword
                      ? "Set your password"
                      : "Set a new password"}
                  </h1>

                  <p className="text-sm text-muted-foreground">
                    {isFirstPassword
                      ? "Choose a password to finish joining the workspace. At least 8 characters."
                      : "Choose a new password for your account. At least 8 characters."}
                  </p>
                </div>

                {form.formState.errors.root && (
                  <Alert
                    variant="destructive"
                    className="rounded-[10px] px-3.5 py-3"
                  >
                    <CircleAlert className="size-4.5" aria-hidden />

                    <AlertDescription className="text-sm">
                      {form.formState.errors.root?.message}
                    </AlertDescription>
                  </Alert>
                )}

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem className="flex flex-col gap-2">
                      <FormLabel className="font-semibold text-foreground">
                        New password
                      </FormLabel>

                      <FormControl>
                        <PasswordInput
                          placeholder="••••••••"
                          disabled={isPending}
                          className="h-11 rounded-sm pr-10 text-sm"
                          {...field}
                        />
                      </FormControl>

                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem className="flex flex-col gap-2">
                      <FormLabel className="font-semibold text-foreground">
                        Confirm password
                      </FormLabel>

                      <FormControl>
                        <PasswordInput
                          placeholder="••••••••"
                          disabled={isPending}
                          className="h-11 rounded-lg text-sm"
                          {...field}
                        />
                      </FormControl>

                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  disabled={isPending}
                  className="h-11 font-semibold"
                >
                  {isPending ? (
                    <span className="flex items-center gap-2">
                      <LoadingSpinner />
                      Saving...
                    </span>
                  ) : isFirstPassword ? (
                    "Set password"
                  ) : (
                    "Update password"
                  )}
                </Button>
              </>
            )}
          </AuthCard>
        </Form>
      </div>
    </AuthShell>
  );
}
