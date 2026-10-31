"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMounted } from "@/hooks/use-mounted";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CircleAlert,
  Clock3,
  Loader2,
  LogIn,
  MailCheck,
  MoonStar,
} from "lucide-react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { BackLink } from "@/components/shared/back-link";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  checkGuestEmailAction,
  discardUploadsAction,
  prepareRequestUploadsAction,
  submitGuestRequestAction,
  submitRequestAction,
} from "@/features/portal/actions/portal.actions";
import { PortalAttachmentPicker } from "@/features/portal/components/portal-attachment-picker";
import { applyFieldErrors } from "@/features/portal/form-errors";
import { portalToastSuccess } from "@/features/portal/portal-toast";
import {
  supportClosedCreatedMessage,
  supportClosedFormMessage,
  type PortalSupportClosed,
} from "@/features/portal/support-closed";
import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";
import { prepareAndUpload } from "@/features/portal/upload";
import { cn } from "@/lib/utils";
import {
  portalGuestRequestSchema,
  portalSignedInRequestFormSchema,
  type PortalGuestRequestValues,
} from "@/features/portal/schemas/portal.schema";

/** Mirror the schema's limits, so the browser stops typing where zod would fail. */
const SUBJECT_MAX = 200;
const DESCRIPTION_MAX = 10_000;

const FIELD_CLASS = "h-11 rounded-lg bg-background/60 text-sm";
const LABEL_CLASS =
  "flex items-center gap-1.5 text-sm font-semibold text-foreground";

/**
 * One form serves both the signed-in and the signed-out paths. Signed out, a
 * first-time customer files the ticket straight away with their name and
 * email; the account is set up from it and they are emailed a link to set a
 * password. An email that already has a sign-in is sent to sign in instead,
 * so nobody can post into somebody else's account.
 */
export function PortalNewRequestForm({
  tenantSlug,
  isSignedIn,
  firstResponseTarget,
  initialSubject = "",
  supportClosed = null,
}: {
  tenantSlug: string;
  isSignedIn: boolean;
  firstResponseTarget: string;
  /** Support is closed right now; the form says when it reopens. */
  supportClosed?: PortalSupportClosed | null;
  /** Pre-filled from the help centre. */
  initialSubject?: string;
}) {
  const router = useRouter();
  const mounted = useMounted();

  const [banner, setBanner] = useState<string | undefined>();
  const [files, setFiles] = useState<File[]>([]);
  // Signed out: the email Create ticket found to already have a sign-in.
  const [signInEmail, setSignInEmail] = useState<string | undefined>();

  const form = useForm<PortalGuestRequestValues>({
    defaultValues: {
      subject: initialSubject,
      description: "",
      email: "",
      fullName: "",
    },
    // A signed-in customer never types an email, so the email rule is not run
    // for them: the field is not rendered, and a rule failing on a hidden
    // input made the form silently do nothing on submit. Both schemas have the
    // same shape, so this needs no cast. See portalSignedInRequestFormSchema.
    resolver: isSignedIn
      ? zodResolver(portalSignedInRequestFormSchema)
      : zodResolver(portalGuestRequestSchema),
  });

  async function onSubmit(values: PortalGuestRequestValues) {
    setBanner(undefined);
    setSignInEmail(undefined);

    const email = values.email.trim();

    try {
      // Signed out, an address that already has a sign-in has to use it.
      // Asked before the upload so its files are not sent for nothing; the
      // server refuses the address again when the ticket is filed.
      if (!isSignedIn) {
        const check = await checkGuestEmailAction(tenantSlug, { email });

        if (!check.success) {
          applyFieldErrors(form, check.fieldErrors);
          setBanner(check.message);
          return;
        }

        if (check.data.hasAccount) {
          setSignInEmail(email);
          return;
        }
      }

      // Bytes first, request second. The storage path an attachment ends up on
      // is built from the ticket id, so these land on a staging path that the
      // server moves across once the ticket exists -- and a request is never
      // filed without the evidence it refers to.
      const discard = (paths: string[]) =>
        discardUploadsAction(tenantSlug, paths);

      const uploads = await prepareAndUpload(
        files,
        (descriptors) => prepareRequestUploadsAction(tenantSlug, descriptors),
        discard,
      );

      if (!isSignedIn) {
        const result = await submitGuestRequestAction(
          tenantSlug,
          {
            email,
            fullName: values.fullName,
            subject: values.subject,
            description: values.description,
          },
          uploads,
        );

        if (result.success) {
          // The check-email screen says the request is in and what to do next.
          router.replace(result.data.redirectTo);
          return;
        }

        void discard(uploads.map((upload) => upload.path));

        if (result.code === "sign_in_required") {
          setSignInEmail(email);
          return;
        }

        applyFieldErrors(form, result.fieldErrors);
        setBanner(result.message);
        return;
      }

      const result = await submitRequestAction(
        tenantSlug,
        {
          subject: values.subject,
          description: values.description,
        },
        uploads,
      );

      if (result.success) {
        // Carries the plan's response promise rather than "request submitted",
        // because that is the thing they cannot see once they leave the form.
        // Outside business hours the promise would read as broken, so they're
        // told when the team is back instead.
        if (result.data.closed) {
          portalToastSuccess(supportClosedCreatedMessage(result.data.closed), {
            duration: 10_000,
          });
        } else {
          portalToastSuccess(
            `Ticket created. Expect a reply within ${firstResponseTarget}.`,
          );
        }
        router.replace(result.data.redirectTo);
        return;
      }

      // Refused after the files landed: nothing will ever move them out of
      // staging, so hand them back now rather than leave them to the sweep.
      void discard(uploads.map((upload) => upload.path));

      applyFieldErrors(form, result.fieldErrors);
      setBanner(result.message);
    } catch (uploadFailure) {
      const message =
        uploadFailure instanceof Error
          ? uploadFailure.message
          : "We couldn't create your ticket. Try again.";

      // The banner says it; no toast on top (RISK-047).
      setBanner(message);
    }
  }

  const isSubmitting = form.formState.isSubmitting;
  const backHref = portalPath(
    tenantSlug,
    isSignedIn ? PORTAL_ROUTES.REQUESTS : PORTAL_ROUTES.LOGIN,
  );

  return (
    <div className="mx-auto w-full max-w-7xl md:px-6">
      <BackLink href={backHref}>
        {isSignedIn ? "Your requests" : "Back to sign in"}
      </BackLink>

      <div className="mt-4 mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-balance text-foreground sm:text-[1.75rem]">
          Create a ticket
        </h1>

        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
          Tell us what you need help with. Our support team will get back to you
          within{" "}
          <span className="font-semibold text-foreground">
            {firstResponseTarget}
          </span>{" "}
          on your support plan.
        </p>
      </div>

      <div className="min-w-0">
        {!isSignedIn ? <NoAccountNeededNotice tenantSlug={tenantSlug} /> : null}

        {supportClosed ? (
          <div
            role="status"
            className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900"
          >
            <MoonStar className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="text-sm leading-5">
              {/* The opening is in the visitor's time zone, which the server
                  can't know: the full sentence waits for the browser. */}
              {mounted
                ? supportClosedFormMessage(supportClosed)
                : "Support is currently closed. You can still create a ticket."}
            </p>
          </div>
        ) : null}

        {banner ? (
          <Alert
            variant="destructive"
            className="mb-5 rounded-xl border-destructive/20 bg-destructive/5 px-4 py-3"
          >
            <CircleAlert className="size-4" aria-hidden />
            <AlertDescription className="text-sm leading-5">
              {banner}
            </AlertDescription>
          </Alert>
        ) : null}

        <Form {...form}>
          <form
            noValidate
            onSubmit={form.handleSubmit(onSubmit)}
            className="rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.05)] sm:p-7"
          >
            <div className="flex flex-col gap-5">
              {!isSignedIn ? (
                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={LABEL_CLASS}>
                          Your email
                          <RequiredMark />
                        </FormLabel>

                        <FormControl>
                          <Input
                            {...field}
                            onChange={(event) => {
                              field.onChange(event);
                              setSignInEmail(undefined);
                            }}
                            type="email"
                            autoComplete="email"
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
                    name="fullName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={LABEL_CLASS}>
                          Your name
                          <RequiredMark />
                        </FormLabel>

                        <FormControl>
                          <Input
                            {...field}
                            autoComplete="name"
                            placeholder="Marcus Feld"
                            className={FIELD_CLASS}
                          />
                        </FormControl>

                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ) : null}

              {!isSignedIn && signInEmail ? (
                <SignInRequired tenantSlug={tenantSlug} email={signInEmail} />
              ) : null}

              <FormField
                control={form.control}
                name="subject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={LABEL_CLASS}>
                      Subject
                      <RequiredMark />
                    </FormLabel>

                    <FormControl>
                      <Input
                        {...field}
                        autoFocus={isSignedIn}
                        placeholder="e.g. Can't log in after SSO switch"
                        maxLength={SUBJECT_MAX}
                        className={FIELD_CLASS}
                      />
                    </FormControl>

                    <FormDescription className="text-xs">
                      Write a short summary of your issue.
                    </FormDescription>

                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={LABEL_CLASS}>
                      Description
                      <RequiredMark />
                    </FormLabel>

                    <FormControl>
                      <Textarea
                        {...field}
                        rows={6}
                        placeholder="Describe what happened, when the issue started, and any steps you've already tried."
                        maxLength={DESCRIPTION_MAX}
                        className="min-h-36 max-h-80 resize-none overflow-y-auto rounded-lg bg-background/60 text-sm leading-6"
                      />
                    </FormControl>

                    <div className="flex items-start justify-between gap-4">
                      <FormDescription className="text-xs">
                        Include any error messages, relevant details, or steps
                        to reproduce the issue.
                      </FormDescription>
                      <span
                        aria-live="polite"
                        className={cn(
                          "shrink-0 text-xs tabular-nums",
                          field.value.length > DESCRIPTION_MAX * 0.9
                            ? "text-warning-strong"
                            : "text-muted-foreground",
                        )}
                      >
                        {field.value.length.toLocaleString("en-GB")}/
                        {DESCRIPTION_MAX.toLocaleString("en-GB")}
                      </span>
                    </div>

                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex flex-col gap-2">
                <p className={LABEL_CLASS}>Attachments</p>

                <PortalAttachmentPicker
                  variant="dropzone"
                  files={files}
                  onChange={setFiles}
                  onError={setBanner}
                  disabled={isSubmitting}
                />
              </div>

              <div className="mt-1 flex flex-col gap-4 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
                {/* The side panel says this on a wide screen; on a phone
                      it is hidden, so the promise lives here instead. */}
                <p className="flex items-center gap-2 text-xs leading-5 text-muted-foreground lg:invisible">
                  <Clock3 aria-hidden className="size-3.5 shrink-0" />
                  <span>
                    We&apos;ll respond within{" "}
                    <span className="font-semibold text-foreground">
                      {firstResponseTarget}
                    </span>
                    .
                  </span>
                </p>

                {/* Stacked full width on a phone, one button per row, with
                    Submit on top where the thumb lands first: two half-width
                    buttons cramped both labels. From sm up there is room for
                    both side by side, Cancel first. */}
                <div className="flex w-full flex-col-reverse gap-2.5 sm:w-auto sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="h-11 w-full px-5 font-semibold sm:w-auto"
                    disabled={isSubmitting}
                    onClick={() => router.push(backHref)}
                  >
                    Cancel
                  </Button>

                  <Button
                    type="submit"
                    size="lg"
                    className="h-11 w-full px-5 font-semibold sm:w-auto"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 aria-hidden className="size-4 animate-spin" />
                        Creating…
                      </>
                    ) : (
                      "Create ticket"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}

function RequiredMark() {
  return (
    <span aria-hidden className="-ml-1 text-destructive">
      *
    </span>
  );
}

/** Signed out: said up front, before anything is typed. */
function NoAccountNeededNotice({ tenantSlug }: { tenantSlug: string }) {
  return (
    <div
      role="note"
      className="mb-5 flex items-start gap-3 rounded-xl border border-brand-accent/25 bg-brand-accent/5 px-4 py-3 text-foreground"
    >
      <MailCheck
        className="mt-0.5 size-4 shrink-0 text-brand-accent"
        aria-hidden
      />
      <p className="text-sm leading-5">
        <span className="font-semibold">No account needed.</span> Create your
        ticket and we&apos;ll email you a link to set a password, so you can
        follow it and reply. Already have an account?{" "}
        <Link
          href={portalPath(tenantSlug, PORTAL_ROUTES.LOGIN)}
          className="font-semibold text-brand-ink underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * The email already has a portal sign-in. The ticket has to come from that
 * account: otherwise anyone knowing an email could post as it. Not an error,
 * so not red -- a clear next step instead.
 */
function SignInRequired({
  tenantSlug,
  email,
}: {
  tenantSlug: string;
  email: string;
}) {
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-xl border border-brand-accent/25 bg-brand-accent/5 px-4 py-3.5 sm:flex-row sm:items-center"
    >
      <p className="min-w-0 flex-1 text-sm leading-5 text-foreground">
        <span className="font-semibold break-all">{email}</span> already has an
        account. Sign in to create your ticket - it will be saved with your
        other requests.
      </p>

      <Button
        asChild
        className="h-10 shrink-0 px-4 font-semibold max-sm:w-full"
      >
        <Link
          href={`${portalPath(tenantSlug, PORTAL_ROUTES.LOGIN)}?email=${encodeURIComponent(email)}`}
        >
          <LogIn aria-hidden className="size-4" />
          Sign in to continue
        </Link>
      </Button>
    </div>
  );
}
