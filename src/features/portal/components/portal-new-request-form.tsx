"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  Clock3,
  Loader2,
} from "lucide-react";
import { useForm, type Resolver } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
  prepareRequestUploadsAction,
  submitGuestRequestAction,
  submitRequestAction,
} from "@/features/portal/actions/portal.actions";
import { PortalAttachmentPicker } from "@/features/portal/components/portal-attachment-picker";
import { applyFieldErrors } from "@/features/portal/form-errors";
import {
  portalToastError,
  portalToastResult,
  portalToastSuccess,
} from "@/features/portal/portal-toast";
import {
  PORTAL_ROUTES,
  portalPath,
  type PortalUploadedFile,
} from "@/features/portal/portal";
import { uploadToTargets } from "@/features/portal/upload";
import { cn } from "@/lib/utils";
import {
  portalGuestRequestSchema,
  portalRequestSchema,
  type PortalGuestRequestValues,
} from "@/features/portal/schemas/portal.schema";

/** Mirror the schema's limits, so the browser stops typing where zod would fail. */
const SUBJECT_MAX = 200;
const DESCRIPTION_MAX = 10_000;

const FIELD_CLASS = "h-11 rounded-lg bg-background/60 text-sm";
const LABEL_CLASS =
  "flex items-center gap-1.5 text-sm font-semibold text-foreground";

/**
 * One form serves both the signed-in and the signed-out paths. They differ only
 * in whether the email is asked for or taken from the session, so splitting them
 * would duplicate the subject/description/attachment block twice over.
 */
export function PortalNewRequestForm({
  tenantSlug,
  isSignedIn,
  firstResponseTarget,
  initialSubject = "",
}: {
  tenantSlug: string;
  isSignedIn: boolean;
  firstResponseTarget: string;
  /** Pre-filled from the help centre. */
  initialSubject?: string;
}) {
  const router = useRouter();

  const [banner, setBanner] = useState<string | undefined>();
  const [files, setFiles] = useState<File[]>([]);
  const [submittedTo, setSubmittedTo] = useState<string | undefined>();

  const form = useForm<PortalGuestRequestValues>({
    defaultValues: {
      subject: initialSubject,
      description: "",
      email: "",
      fullName: "",
    },
    // A signed-in customer never types an email, so validate against the
    // schema that has no email field at all.
    //
    // NOT `.partial({ email: true })`: that permits `undefined`, while
    // defaultValues sends `""`. An empty string is not undefined, so the email
    // rules still ran and failed -- invisibly, because the field is not
    // rendered when signed in. The form simply did nothing on submit.
    // portalRequestSchema drops the key instead, and zod strips the extras.
    resolver: zodResolver(
      isSignedIn ? portalRequestSchema : portalGuestRequestSchema,
    ) as unknown as Resolver<PortalGuestRequestValues>,
  });

  async function onSubmit(values: PortalGuestRequestValues) {
    setBanner(undefined);

    try {
      // Bytes first, request second. The storage path an attachment ends up on
      // is built from the ticket id, so these land on a staging path that the
      // server moves across once the ticket exists -- and a request is never
      // filed without the evidence it refers to.
      let uploads: PortalUploadedFile[] = [];

      if (files.length > 0) {
        const prepared = await prepareRequestUploadsAction(
          tenantSlug,
          files.map((file) => ({
            name: file.name,
            size: file.size,
            type: file.type,
          })),
        );

        if (!prepared.success) {
          setBanner(prepared.message);
          portalToastError(prepared.message);
          return;
        }

        uploads = await uploadToTargets(prepared.data.targets, files);
      }

      const result = isSignedIn
        ? await submitRequestAction(
            tenantSlug,
            {
              subject: values.subject,
              description: values.description,
            },
            uploads,
          )
        : await submitGuestRequestAction(tenantSlug, values, uploads);

      if (result.success) {
        if ("redirectTo" in result.data) {
          // Fired before the redirect, which is why the guest branch below does
          // not toast: it stays on this screen and the confirmation panel it
          // swaps in is the feedback.
          //
          // Carries the plan's response promise rather than "request submitted",
          // because that is the thing they cannot see once they leave the form.
          portalToastSuccess(
            `Request sent. Expect a reply within ${firstResponseTarget}.`,
          );
          router.replace(result.data.redirectTo);
          return;
        }

        setSubmittedTo(result.data.email);
        form.reset();
        setFiles([]);

        return;
      }

      applyFieldErrors(form, result.fieldErrors);
      setBanner(result.message);
      portalToastResult(result);
    } catch (uploadFailure) {
      const message =
        uploadFailure instanceof Error
          ? uploadFailure.message
          : "We couldn't submit your request. Try again.";

      setBanner(message);
      portalToastError(message);
    }
  }

  if (submittedTo) {
    return <GuestConfirmation tenantSlug={tenantSlug} email={submittedTo} />;
  }

  const isSubmitting = form.formState.isSubmitting;
  const backHref = portalPath(
    tenantSlug,
    isSignedIn ? PORTAL_ROUTES.REQUESTS : PORTAL_ROUTES.LOGIN,
  );

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 rounded-md text-sm font-semibold text-brand-ink underline-offset-4 transition-colors hover:text-brand-ink hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {isSignedIn ? "Your requests" : "Back to sign in"}
      </Link>

      <div className="mt-4 mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-balance text-foreground sm:text-[1.75rem]">
          Submit a request
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
                          <span className="font-normal text-muted-foreground">
                            (optional)
                          </span>
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
                        className="min-h-36 resize-y rounded-lg bg-background/60 text-sm leading-6"
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

                <div className="grid grid-cols-2 gap-2.5 sm:flex sm:w-auto">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="h-11 px-5 font-semibold"
                    disabled={isSubmitting}
                    onClick={() => router.push(backHref)}
                  >
                    Cancel
                  </Button>

                  <Button
                    type="submit"
                    size="lg"
                    className="h-11 px-5 font-semibold"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 aria-hidden className="size-4 animate-spin" />
                        Submitting…
                      </>
                    ) : (
                      "Submit request"
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

function GuestConfirmation({
  tenantSlug,
  email,
}: {
  tenantSlug: string;
  email: string;
}) {
  return (
    <div className="mx-auto w-full max-w-120 rounded-2xl border bg-card p-6 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.06)] sm:p-8">
      <span
        aria-hidden
        className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-accent/10 text-brand-accent ring-8 ring-brand-accent/5"
      >
        <CheckCircle2 className="size-7" />
      </span>

      <h1 className="mt-5 text-2xl font-bold tracking-tight text-foreground">
        We&apos;ve got it
      </h1>

      <p className="mt-2 text-sm leading-[1.6] text-muted-foreground">
        Your request is with our team. We&apos;ll reply to{" "}
        <strong className="font-bold text-foreground">{email}</strong>. Sign in
        with that address any time to follow it here.
      </p>

      <Button asChild size="lg" className="mt-6 h-11 px-6 font-semibold">
        <Link href={portalPath(tenantSlug, PORTAL_ROUTES.LOGIN)}>
          Sign in to track it
        </Link>
      </Button>
    </div>
  );
}
