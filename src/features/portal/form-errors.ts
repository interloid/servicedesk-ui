import type { FieldValues, Path, UseFormReturn } from "react-hook-form";

/**
 * Re-attach the server's per-field messages to the form that produced them.
 *
 * The portal actions re-validate with the same zod schema the client used, so
 * a field error coming back means the request was tampered with or the rules
 * moved — either way the message belongs on the field, not in the banner.
 */
export function applyFieldErrors<TValues extends FieldValues>(
  form: UseFormReturn<TValues>,
  fieldErrors?: Record<string, string[]>,
): void {
  for (const [field, messages] of Object.entries(fieldErrors ?? {})) {
    const message = messages?.[0];

    if (message) {
      form.setError(field as Path<TValues>, { message });
    }
  }
}
