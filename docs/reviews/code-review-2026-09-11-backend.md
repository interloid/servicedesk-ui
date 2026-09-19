# Code Review Report — Backend Follow-up

- **Date:** 2026-09-11
- **Reviewer:** Claude Code (automated review)
- **Scope:** Follow-up to [code-review-2026-09-11.md](./code-review-2026-09-11.md), which covered `src/`. This pass covers `supabase/functions/subscription`, `supabase/functions/paypal-webhook/*`, `supabase/functions/reconcile-subscriptions`, `supabase/functions/update-payment-method`, `supabase/functions/_shared/paypal-payment-method.ts`, the `supabase/migrations/2026*` billing/tenancy migrations, `supabase/schemas/policies/*` (subscriptions, invoices, payment_methods, subscription_switches), `next.config.ts` and `package.json` / `package-lock.json`.
- **Verdict:** NEEDS ATTENTION (at review time) · **Post-fix:** HEALTHY — 28 of 29 fixed, 1 partial

Findings RISK-001 … RISK-023 belong to the previous report and are not repeated. Limitations the PR description already disclosed are not reported.

---

## How the fixes were constrained

The brief was **fix the findings without changing any billing flow**. Every fix keeps the happy path of subscribe / upgrade / downgrade / cancel / abort / activate exactly as it was. What changes is what happens on the edges the review found: races, retries, bad input and failures.

The edge behaviour that is visible to a caller:

| Where                                                      | Before                              | After                                                                |
| ---------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| Two concurrent plan-change requests for one tenant         | Both could open a PayPal agreement  | The second gets **409** "Another plan change is already in progress" |
| Concurrent `capture-order` needing a replacement agreement | Both could create one               | The second gets **409** "already being processed"                    |
| `abort` on a switch that `activate` already made live      | Reverted the tenant to the old plan | Leaves it alone, `restored: false`                                   |
| Invoice email failed for every recipient                   | Logged; email lost for good         | Webhook fails, so PayPal redelivers and the email is retried         |
| Webhook body over 512 KB                                   | Buffered, then verified with PayPal | **413** before any work                                              |
| Error responses from `subscription`                        | Included raw Postgres text          | Generic message; full error only in the logs                         |
| All HTML pages                                             | Some could be prerendered           | Rendered per request (needed for the CSP nonce)                      |

---

## Resolution per finding

### High

- **RISK-024 — charge captured, no invoice on plan-lookup failure.** `capture-order` now loads the target plan **before** capturing. If the plan is missing, the buyer is never charged. The invoice upsert also stopped swallowing errors: Supabase returns them in the result, so the old `.then().catch()` never ran. They are now logged as errors.
- **RISK-025 — duplicate invoice emails on retry.** New column `invoices.email_sent_at`. `emailInvoiceOnce()` in `paypal-webhook/handlers.ts` claims it with a conditional `UPDATE … WHERE email_sent_at IS NULL` right before sending. Only the delivery that wins the claim sends. Invoices that already have a PDF are back-filled as sent, so redelivered old events do not re-email them.
- **RISK-026 — reconcile unreachable by cron.** Added `[functions.reconcile-subscriptions] verify_jwt = false` to `supabase/config.toml`. The function still authenticates itself with `x-cron-secret`.
- **RISK-027 — `subscription_switches` had no RLS.** Migration `20260911130000_billing_review_hardening.sql` enables RLS and adds a SELECT policy for tenant and billing admins; the billing dashboard reads switches through that policy. **Deviation from the suggested fix:** no UPDATE policy is granted. No client writes switches, and an UPDATE policy would let a billing admin change `plan_id` on their own pending upgrade to a pricier plan before `capture-order` reads it. `schemas/policies/21_subscription_switches.sql` was changed to match.
- **RISK-028 — "already captured" path skipped the invoice.** The order-read helpers were moved out of `capturePaypalOrder`. On that fallback path the order is now re-read (`GET /v2/checkout/orders/{id}`) to recover `txnId` and `amount`, so the invoice is written. This path was also the source of 11 of the function's 19 pre-existing `deno check` errors.
- **RISK-029 — invalid currency crashed the PDF.** `createMoneyFormatter()` in `pdf.ts` does not throw. A malformed code falls back to `"<code> <number>"`, and a symbol outside WinAnsi falls back to the ISO code (`INR 1,000.00`).
- **RISK-030 — non-WinAnsi tenant name crashed the PDF.** Every string field passed to `generateInvoicePdf` goes through a WinAnsi sanitizer built from the font's own character set. Accented Latin letters are kept, others are transliterated through NFKD (`Ł` → `L`), and anything else becomes `?`.
- **RISK-031 — missing plan silently set seats to 1.** `reconcile-subscriptions` now throws for that switch. It is counted in `summary.failed`, logged, and retried on the next run.

### Medium

- **RISK-032 — duplicate replacement subscriptions.** New column `subscription_switches.locked_until`. Creating a replacement agreement requires a 2-minute lease, claimed with a conditional update. The claim only succeeds while the switch is still keyed on the captured order; the rekey to the replacement id marks that work done. The lease is released in `finally` and expires on its own if a request dies.
- **RISK-033 — no constraint on open switches.** New partial unique index `uq_subscription_switches_one_open_per_tenant` on `(tenant_id) WHERE status IN ('pending','approved')`. Any existing duplicates are cancelled first, oldest first, the same way the next request would resolve them. A 23505 on insert returns 409 through `switchInsertFailedResponse()`.
- **RISK-034 — `abort` reverted a live plan.** An `approved` switch with no `effective_at` whose plan already matches the tenant's subscription is left alone.
- **RISK-035 — failed emails lost forever.** If no recipient receives the email, `email_sent_at` is released and the error rethrown. The webhook then fails and PayPal's redelivery retries the email. The early return checks for a stored PDF **and** a sent email, and the PDF is not regenerated on a retry. If at least one recipient got it, the claim stands, so nobody is emailed twice.
- **RISK-036 — `payment_methods` SELECT had no role check.** Limited to tenant and billing admins, both in the migration and in `schemas/policies/22_payment_methods.sql`.
- **RISK-037 — CSP allowed `'unsafe-inline'` scripts.** CSP moved from `next.config.ts` to `src/proxy.ts` and `src/lib/csp.ts`, with a fresh nonce per request plus `'strict-dynamic'`. The root layout reads the nonce, which renders every page dynamically; a prerendered page would ship scripts without the nonce and have them blocked. `style-src` keeps `'unsafe-inline'` because components set inline style attributes.
- **RISK-038 — react / react-dom pin mismatch.** Both are pinned to `19.2.8` in `package.json` and the lockfile's root entry.
- **RISK-039 — preserveCard race.** When a concurrent delivery for a _different_ agreement wins the insert, the losing write is skipped (`"skipped"` outcome) unless its agreement is the tenant's current `subscriptions.paypal_subscription_id`.
- **RISK-040 — no OAuth token cache.** New `_shared/paypal-auth.ts`: tokens are cached per isolate until one minute before `expires_in`, and concurrent cold callers share one request. All four functions use it, replacing four copies of the token code.

### Low

- **RISK-041** — no `details: …Error.message` and no `${…Error.message}` in any `subscription` response. Errors are logged server-side.
- **RISK-042** — `reason` must be a non-empty string at runtime. Cancellation-reason insert errors are now actually logged (`logCancellationReason()`); the old `.catch` never fired.
- **RISK-043** — `reviseSubscriptionPlan()` replaces the three inline revise calls (the upgrade capture and both paid-downgrade branches).
- **RISK-044** — `abort` returns `restored: true` only when a restore ran, and skips the plan lookup with a null id.
- **RISK-045** — webhook body capped at 512 KB, checked against `Content-Length` and counted while streaming. Oversized requests get 413.
- **RISK-046** — `paypal-webhook/paypal.ts` checks each required env var at startup and throws an error naming the missing one.
- **RISK-047** — `escapeHtml()` for every value interpolated into the invoice email, including the `href`.
- **RISK-048** — `claimSwitch()` / `releaseSwitch()` in the webhook: a switch is moved to `applied` with a conditional update _before_ its effects run. Only one delivery applies it and cancels the old agreement, and a failed apply is released so PayPal's redelivery can retry.
- **RISK-049** — the cron secret is compared in constant time: both sides are SHA-256 hashed, then compared byte by byte.
- **RISK-050** — `parsePayPalSubscriber()` narrows PayPal's raw `subscriber` JSON field by field and warns naming any mismatched field. `storePayPalPaymentMethod` now takes `unknown` and parses it, so every caller is covered.
- **RISK-051** — the three empty blocks were removed; `buildPayload` now returns only the payload.
- **RISK-052** — **partial.** The migration's misleading header comment now says it is a no-op. The file stays because it is already in migration history; dropping it would break `db push`. Whether `tenants.status` was ever meant to get a `trialing` value is a product decision and was not changed.

---

## Verification

- **PDF (RISK-029/030):** a scratch script ran the committed and the new `pdf.ts` on 7 inputs. The committed version failed on `XXX9` (RangeError), `INR` (`₹`), a CJK/emoji tenant name, and `Łódź`. The new version rendered all 7, and the USD baseline and accented-Latin output are byte-identical in size to before.
- **CSP (RISK-037):** production `next build` passed, and every HTML route is dynamic (ƒ). Against `next start`, `/`, `/login`, `/acme/login`, `/setup` and `/forgot-password` each had every `<script>` tag carrying that response's nonce (20–29 tags per page, none missing). There was no `'unsafe-inline'` in `script-src`, and the nonce differed on every request.
- **Types:** `deno check` on `subscription` went from 19 errors to 3; the 3 are the untouched `GenericStringError` in activate's switch lookups, and there are no new error kinds. The webhook has the same 4 pre-existing errors. `reconcile-subscriptions` and `update-payment-method` are clean. `tsc --noEmit` and ESLint on `src/` are clean.
- **Not executed:** the migration was not run against a database (no local Supabase stack was running). Nothing here ran against PayPal sandbox; the race fixes are verified by reading the code, not by a concurrency test. There is still no test framework (RISK-023).

## Deploying

1. `supabase db push` — applies `20260911130000_billing_review_hardening.sql`.
2. Redeploy all four functions: `subscription`, `paypal-webhook`, `reconcile-subscriptions`, `update-payment-method`. `reconcile-subscriptions` must be redeployed for the `verify_jwt = false` setting to take effect.
3. After the next hourly run, check that `reconcile-subscriptions` receives the cron call (function logs), which confirms RISK-026 end to end.

---

## Risk Tracking Table

| Risk ID  | Priority | Risk (Short Description)                                | File                                                              | Completed | Reason if Not Completed / Notes                                          |
| -------- | -------- | ------------------------------------------------------- | ----------------------------------------------------------------- | --------- | ------------------------------------------------------------------------ |
| RISK-024 | High     | Charge captured, no invoice on plan-lookup failure      | supabase/functions/subscription/index.ts                          | Yes       | Fixed — plan resolved before capture                                     |
| RISK-025 | High     | Webhook retry can send duplicate invoice emails         | supabase/functions/paypal-webhook/handlers.ts                     | Yes       | Fixed — atomic `email_sent_at` claim                                     |
| RISK-026 | High     | reconcile-subscriptions unreachable by cron             | supabase/config.toml                                              | Yes       | Fixed — `verify_jwt = false`; needs redeploy                             |
| RISK-027 | High     | subscription_switches has no RLS at all                 | supabase/migrations/20260911130000_billing_review_hardening.sql   | Yes       | Fixed — RLS + SELECT only (UPDATE deliberately not granted)              |
| RISK-028 | High     | "Already captured" fallback skips invoice write         | supabase/functions/subscription/index.ts                          | Yes       | Fixed — order re-read for txn id / amount                                |
| RISK-029 | High     | Unvalidated currency crashes PDF                        | supabase/functions/paypal-webhook/pdf.ts                          | Yes       | Fixed — non-throwing money formatter; tested                             |
| RISK-030 | High     | Non-WinAnsi tenant name crashes PDF                     | supabase/functions/paypal-webhook/pdf.ts                          | Yes       | Fixed — WinAnsi sanitizer; tested                                        |
| RISK-031 | High     | Missing plan row silently drops seats to 1              | supabase/functions/reconcile-subscriptions/index.ts               | Yes       | Fixed — switch fails loudly, counted in `summary.failed`                 |
| RISK-032 | Medium   | Unlocked pendingSwitch can create duplicate PayPal subs | supabase/functions/subscription/index.ts                          | Yes       | Fixed — `locked_until` lease around replacement creation                 |
| RISK-033 | Medium   | No constraint stops duplicate pending switches          | supabase/migrations/20260911130000_billing_review_hardening.sql   | Yes       | Fixed — partial unique index; 409 on conflict                            |
| RISK-034 | Medium   | abort can revert a plan PayPal still bills              | supabase/functions/subscription/index.ts                          | Yes       | Fixed — live `approved` switch is left alone                             |
| RISK-035 | Medium   | Email failures after storage_path write lost forever    | supabase/functions/paypal-webhook/handlers.ts                     | Yes       | Fixed — claim released + rethrown so PayPal redelivers                   |
| RISK-036 | Medium   | payment_methods SELECT policy missing role check        | supabase/migrations/20260911130000_billing_review_hardening.sql   | Yes       | Fixed — tenant/billing admins only                                       |
| RISK-037 | Medium   | CSP script-src allows 'unsafe-inline' in production     | src/proxy.ts, src/lib/csp.ts                                      | Yes       | Fixed — per-request nonce; all pages now dynamic; verified on prod build |
| RISK-038 | Medium   | react caret vs react-dom exact pin mismatch             | package.json                                                      | Yes       | Fixed — both pinned to 19.2.8                                            |
| RISK-039 | Medium   | preserveCard race can show wrong subscription's card    | supabase/functions/\_shared/paypal-payment-method.ts              | Yes       | Fixed — defers to the tenant's current agreement                         |
| RISK-040 | Medium   | PayPal OAuth token fetched on every call                | supabase/functions/\_shared/paypal-auth.ts                        | Yes       | Fixed — shared cached provider in all 4 functions                        |
| RISK-041 | Low      | Raw DB error text returned to billing client            | supabase/functions/subscription/index.ts                          | Yes       | Fixed — generic messages, errors logged                                  |
| RISK-042 | Low      | Unvalidated cancellation reason silently dropped        | supabase/functions/subscription/index.ts                          | Yes       | Fixed — runtime check; insert errors now logged                          |
| RISK-043 | Low      | Duplicated PayPal revise-subscription logic             | supabase/functions/subscription/index.ts                          | Yes       | Fixed — `reviseSubscriptionPlan()` used in all 3 places                  |
| RISK-044 | Low      | abort always reports restored:true                      | supabase/functions/subscription/index.ts                          | Yes       | Fixed                                                                    |
| RISK-045 | Low      | No request size cap before signature verification       | supabase/functions/paypal-webhook/index.ts                        | Yes       | Fixed — 512 KB cap, 413                                                  |
| RISK-046 | Low      | Missing env vars fail silently                          | supabase/functions/paypal-webhook/paypal.ts                       | Yes       | Fixed — `requireEnv()` at startup                                        |
| RISK-047 | Low      | Customer name unescaped in invoice email HTML           | supabase/functions/paypal-webhook/email.ts                        | Yes       | Fixed — all interpolated values escaped                                  |
| RISK-048 | Low      | Unlocked switch-apply can double-fire PayPal cancel     | supabase/functions/paypal-webhook/handlers.ts                     | Yes       | Fixed — `claimSwitch()` / `releaseSwitch()`                              |
| RISK-049 | Low      | Cron secret compared without timing-safe check          | supabase/functions/reconcile-subscriptions/index.ts               | Yes       | Fixed — hashed constant-time compare                                     |
| RISK-050 | Low      | PayPal API response cast with no runtime validation     | supabase/functions/update-payment-method/index.ts                 | Yes       | Fixed — `parsePayPalSubscriber()` for every caller                       |
| RISK-051 | Low      | Empty no-op code blocks on idempotency paths            | supabase/functions/\_shared/paypal-payment-method.ts              | Yes       | Fixed — removed                                                          |
| RISK-052 | Low      | Migration is a byte-identical no-op despite its name    | supabase/migrations/20260831142748_start_new_tenants_on_trial.sql | Partial   | Comment corrected; file kept (in history); intent needs owner decision   |
