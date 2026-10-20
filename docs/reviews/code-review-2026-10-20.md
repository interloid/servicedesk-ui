# Code Review Report

- **Date:** 2026-10-20
- **Reviewer:** Claude Code (automated review)
- **Scope:** Branding feature — `src/features/branding/`, `src/app/(app)/[tenantSlug]/(base-layout)/settings/branding/` (working tree, including uncommitted edits) · 7 files. Read for context: `src/components/shared/layout/brand-theme.tsx`, `src/features/portal/components/portal-shell.tsx`, `src/features/portal/avatar-url.ts`, `src/features/portal/services/portal.service.ts`, `src/features/tenancy/services/tenant-resolver.ts`, `src/proxy.ts`, `src/lib/tenancy.ts`, tenants/storage SQL.
- **Verdict:** NEEDS ATTENTION

---

## ⚡ 1. High-Risk Issues (Bugs, Security Leaks, Broken Logic)

### RISK-001 · `src/features/branding/branding-actions.ts:80`

- **What is wrong:** Saving a new portal address changes `tenants.slug`. The user's login token still holds the old slug. The editor also stays on the old URL.
- **Why it matters:** `src/proxy.ts:291` sends every request whose URL slug differs from the token slug back to the token slug. That is the old slug. The base layout then finds no workspace with that slug and calls `notFound()`. The admin, and every teammate, sees "not found" on every page until their token refreshes (up to an hour). Customer portal links and bookmarks with the old address also stop working, and the editor gives no warning before this happens.
- **Recommendation:** After a slug change, refresh the session on the server so the token carries the new slug. Then move the editor to the new URL. Warn before saving that old portal links will stop working.
- **Minimal fix:**

```ts
// branding.service.ts — end of updateBranding(), when the slug changed
if (slugChanged) {
  const { error } = await supabase.auth.refreshSession(); // token hook re-reads the slug
  if (error)
    console.error(
      "[branding] session refresh after slug change failed",
      error.message,
    );![![alt text](image-1.png)](image.png)
}
```

```tsx
// branding-editor.tsx — in save(), after a successful result
const router = useRouter();
// ...
if (result.data && result.data.slug !== saved.slug) {
  router.replace(tenantPath(result.data.slug, TENANT_ROUTES.SETTINGS.BRANDING));
}
```

### RISK-002 · `src/features/branding/components/branding-editor.tsx:1601`

- **What is wrong:** The preview paints the portal header with the primary colour (`palette.base`). The live portal paints it with `bg-brand-accent`. `BrandTheme` sets `--brand-accent` to the **secondary** colour when one is set (`brand-theme.tsx:59`).
- **Why it matters:** An admin who sets a secondary colour sees a teal header in the preview. Customers see a header in the secondary colour. The editor hint even says secondary is for "quiet buttons and muted surfaces", and suggests `#F1F5F9`. That gives customers a near-white header. The contrast warning is also checked against the wrong colour, so it can say "fine" for a header that is hard to read.
- **Recommendation:** Make the live portal and the preview use one colour function, so what the admin previews is what ships.
- **Minimal fix:**

```tsx
// brand-theme.tsx — secondary must not take over the brand bar
const accent = brand; // was: safeHex(secondary) ?? brand
if (safeHex(secondary)) {
  shared.push(`--secondary: ${safeHex(secondary)}`);
}
```

(Long term, see RISK-010: let `BrandTheme` build its CSS from `brandCssVars()`.)

---

## ⚠️ 2. Medium-Risk Issues (Performance, Anti-patterns, Next.js Violations)

### RISK-003 · `src/features/branding/components/branding-editor.tsx:274`

- **What is wrong:** The editor checks email with `/^\S+@\S+\.\S+$/`. The server uses `z.email()`, which is stricter. When the server rejects a field, the action returns only "Check the highlighted fields and try again."
- **Why it matters:** An address like `a@b@c.com` passes the editor and fails on the server. The user is told to check highlighted fields, but nothing is highlighted. They cannot tell what to fix.
- **Recommendation:** Validate in the editor with the same Zod schema, and return field errors from the action.
- **Minimal fix:**

```ts
// branding-actions.ts
if (!parsed.success) {
  return {
    ok: false,
    failureCode: "validation",
    message:
      parsed.error.issues[0]?.message ??
      "Check the highlighted fields and try again.",
  };
}
```

### RISK-004 · `src/features/branding/services/branding.service.ts:200`

- **What is wrong:** The "slug already taken" check selects from `tenants`. The `tenants_select` policy only returns the caller's own row, so this check never finds a clash. The server schema also does not reject reserved slugs (`isValidTenantSlug` is not used). The editor lets the user save while the availability check is still running (`slugStatus === "checking"`).
- **Why it matters:** A taken or reserved address is stopped only by the database (unique index or `tenants_slug_not_reserved`). Both come back as "We couldn't save your branding." The user does not learn that the address is the problem.
- **Recommendation:** Reuse `checkSlugAvailability` on the server before the update. Give a clear message for `23505` and `23514`. Block save while the check is pending.
- **Minimal fix:**

```ts
// branding.service.ts — replace the dead clash query
if (slugChanged) {
  const status = await checkSlugAvailability(values.slug);
  if (status === "taken" || status === "invalid") {
    throw new BrandingError(
      status === "taken"
        ? "That portal address is taken."
        : "That address is reserved. Try another.",
      { status: 409, code: status === "taken" ? "slug-taken" : "validation" },
    );
  }
}
```

```tsx
// branding-editor.tsx — validate()
} else if (slugStatus === "checking") {
  next.slug = "Still checking this address. Try again in a moment.";
}
```

### RISK-005 · `src/features/branding/schemas/branding.ts:57`

- **What is wrong:** `logoUrl` accepts any URL. The editor shows it with a plain `<img>` and `AvatarImage`. The portal only shows logos from our storage bucket (`trustedTenantLogoUrl`).
- **Why it matters:** Anyone who calls the action directly can store a logo from any host. The editor then loads that image in every admin's browser, so a third party can see who opens the page. The preview also shows a logo that the live portal hides.
- **Recommendation:** Accept only URLs under this tenant's own folder in the logo bucket, and preview through `trustedTenantLogoUrl`.
- **Minimal fix:**

```ts
// branding.service.ts — updateBranding(), before building nextJson
const logo = values.logoUrl?.trim() || null;
if (
  logo &&
  !trustedTenantLogoUrl(logo)?.includes(
    `/${LOGO_BUCKET}/${actor.tenantId}/branding/`,
  )
) {
  throw new BrandingError("Upload the logo instead of linking it.", {
    code: "validation",
  });
}
```

### RISK-006 · `src/app/(app)/[tenantSlug]/(base-layout)/settings/branding/page.tsx:24`

- **What is wrong:** When `getBranding()` returns `null`, the page returns `null`.
- **Why it matters:** A signed-out race or a missing tenant row shows an empty white panel. There is no message and no way forward.
- **Recommendation:** Call `notFound()` (or redirect to login) instead of rendering nothing.
- **Minimal fix:**

```tsx
if (!branding) {
  notFound();
}
```

### RISK-007 · `src/features/branding/services/branding.service.ts:298`

- **What is wrong:** The 2 MB limit is checked against the size the browser reports. The signed upload URL does not limit size, and the `avatars` bucket has no `file_size_limit`.
- **Why it matters:** An admin can request a token for a 1 KB file and then upload a much larger one. Large files then sit in a public bucket and are served to every portal visitor.
- **Recommendation:** Set `file_size_limit` on the `avatars` bucket in a migration.
- **Minimal fix:**

```sql
update storage.buckets set file_size_limit = 2097152 where id = 'avatars';
```

(Check first that customer avatars also fit inside 2 MB.)

### RISK-008 · `src/features/branding/services/branding.service.ts:155`

- **What is wrong:** Database rows are cast with `as unknown as TenantRow` (lines 155, 194, 278). `branding_json` is free-form `jsonb`.
- **Why it matters:** If a stored value has the wrong type (for example `primary_color: 5`), `json.primary_color?.trim()` throws. The whole branding page then crashes into the error boundary.
- **Recommendation:** Parse `branding_json` with a small Zod schema that drops bad fields, instead of casting.
- **Minimal fix:**

```ts
const brandingJsonSchema = z
  .object({
    logo_url: z.string().nullish().catch(null),
    primary_color: z.string().nullish().catch(null),
    // ...same for the other fields
    show_logo_on_portal: z.boolean().optional().catch(undefined),
  })
  .catch({});
const json = brandingJsonSchema.parse(row.branding_json ?? {});
```

### RISK-009 · `src/app/(app)/[tenantSlug]/(base-layout)/settings/branding/page.tsx:12`

- **What is wrong:** The canonical URL is `/settings/branding`. That path has no route; the real path starts with the tenant slug. `branding-actions.ts:38` already says this path "matched no route".
- **Why it matters:** The page tells browsers and crawlers that its real address is a 404.
- **Recommendation:** Remove `alternates.canonical`, or build it in `generateMetadata` from `params.tenantSlug`.
- **Minimal fix:**

```ts
export const metadata: Metadata = { title: "Branding" };
```

---

## 🏗️ 3. Architectural & Cross-File Findings

### RISK-010 · Affected files: `src/features/branding/branding.ts`, `src/components/shared/layout/brand-theme.tsx`

- **What is wrong:** There are two colour engines. `brandPalette()` + `brandCssVars()` drive the preview. `BrandTheme` drives the live portal with its own rules (different shades, a threshold for text colour, and secondary mapped to the brand bar). `brandCssVars()` is not called anywhere. The comment in `branding.ts:90` says the preview and the app share one function, but they do not.
- **Why it matters:** This is the root cause of RISK-002. Any colour fix has to be made twice, and the preview drifts again.
- **Recommendation:** Have `BrandTheme` build its CSS from `brandCssVars()` (plus the dark-mode rules it adds), and remove the duplicate maths. This is **Medium**, not Low, because it already causes a real bug (RISK-002).

### RISK-011 · Affected files: `branding-editor.tsx`, `schemas/branding.ts`, `branding.ts`, `brand-theme.tsx`, `src/lib/tenancy.ts`

- **What is wrong:** The hex colour regex is defined four times. The slug rule is defined three times (`SLUG_PATTERN` ×2, `SUBDOMAIN_LABEL`). The schema hard-codes `120` and `63` instead of using `MAX_NAME_LENGTH` and `MAX_SLUG_LENGTH`. `updateBranding` repeats the `requireAdmin` check inline.
- **Why it matters:** A rule change has to be made in up to four places, so one gets missed. RISK-003 and RISK-004 are both cases where these copies already disagree.
- **Recommendation:** Export the regexes and limits from `branding.ts` / `lib/tenancy.ts` and import them everywhere. Call `requireAdmin` in `updateBranding`.

### RISK-012 · Affected files: `branding-editor.tsx`, `branding.ts`

- **What is wrong:** Dead code: `PreviewHeader` (`branding-editor.tsx:1365`, ESLint warns), `BRANDING_OK` (`branding.ts:82`), `brandCssVars` (see RISK-010). The `logoUrl` check in `validate()` guards a field the user can no longer type into.
- **Why it matters:** Readers assume dead code is used and keep it in sync for nothing.
- **Recommendation:** Delete these, or wire `brandCssVars` up as part of RISK-010.

### RISK-013 · Affected files: `branding.service.ts`, `branding-editor.tsx`

- **What is wrong:** Each upload creates a new `logo-<timestamp>` file. Replacing or removing the logo, or abandoning an upload, never deletes the old file.
- **Why it matters:** Old logos pile up in a public bucket. A logo a tenant "removed" stays reachable at its old URL.
- **Recommendation:** After a successful save, delete files in `<tenant>/branding/` other than the current logo. Or add a sweep like the staging-upload sweep.

### RISK-014 · Affected files: `branding.service.ts`, `src/features/portal/components/portal-shell.tsx`

- **What is wrong:** The "Show logo" switch is saved to `show_logo_on_portal`, and the preview honours it. The portal never reads it. This is a known deferral.
- **Why it matters:** An admin who turns the logo off still sees it on the live portal. The preview says otherwise.
- **Recommendation:** Map `show_logo_on_portal` in `portal.service.ts` and check it in `TenantMark`. Until then, label the switch "coming soon" or hide it.

---

## 🧪 4. Required Test Cases

| Risk ID  | Test                                                                                                             | Should prove                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| RISK-001 | As a Tenant Admin, change the slug from `acme` to `acme-help`, save, then click any sidebar link.                | The page loads under `/acme-help/...`; no "not found" page appears.                     |
| RISK-001 | After the slug change, sign in as a second team member whose token was issued earlier, and open `/acme/tickets`. | They reach `/acme-help/tickets` (or are sent to sign in again), not a "not found" page. |
| RISK-001 | Change the slug and confirm the editor shows a warning that old portal links stop working before saving.         | The admin agrees to the break before it happens.                                        |
| RISK-002 | Set primary `#0f766e` and secondary `#f1f5f9`, save, then open the live portal.                                  | The live portal header colour equals the preview header colour.                         |
| RISK-002 | Set secondary to a light colour and primary to a dark one. Check the contrast warning.                           | The warning uses the colour the live header actually uses.                              |
| RISK-002 | Clear the secondary colour and save.                                                                             | Preview and portal both fall back to the primary colour for the header.                 |

---

## 🏁 5. Verdict

**NEEDS ATTENTION.** The editor is careful and well commented, and the server checks admin rights and validates input. But two flows break what the user sees: changing the portal address locks the whole team out of the app until tokens refresh, and the preview header does not match the live portal once a secondary colour is set. Fix RISK-001 first.

---

## 📋 6. Risk Tracking Table

| Risk ID  | Priority | Risk (Short Description)                   | File                                                                  | Completed | Reason if Not Completed                                                                                                                                        |
| -------- | -------- | ------------------------------------------ | --------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RISK-001 | High     | Slug change shows not-found to team        | `src/features/branding/branding-actions.ts`                           | Partly    | Admin session refreshed + editor moves to new URL + warning shown. Teammates still see not-found until their token refreshes (≤1h) — needs a proxy/auth change |
| RISK-002 | High     | Preview header colour differs from portal  | `src/features/branding/components/branding-editor.tsx`                | Yes       | —                                                                                                                                                              |
| RISK-003 | Medium   | Server validation error highlights nothing | `src/features/branding/components/branding-editor.tsx`                | Yes       | —                                                                                                                                                              |
| RISK-004 | Medium   | Taken/reserved slug gives generic error    | `src/features/branding/services/branding.service.ts`                  | Yes       | —                                                                                                                                                              |
| RISK-005 | Medium   | Logo URL accepts any external host         | `src/features/branding/schemas/branding.ts`                           | Yes       | —                                                                                                                                                              |
| RISK-006 | Medium   | Missing branding renders a blank page      | `src/app/(app)/[tenantSlug]/(base-layout)/settings/branding/page.tsx` | Yes       | —                                                                                                                                                              |
| RISK-007 | Medium   | Logo size limit not enforced server-side   | `src/features/branding/services/branding.service.ts`                  | Partly    | Bucket capped at 5 MB (migration 20261020120000, pending on live); 2 MB logo cap still browser-reported — bucket is shared with 5 MB customer photos           |
| RISK-008 | Medium   | Unsafe casts on branding_json rows         | `src/features/branding/services/branding.service.ts`                  | Yes       | —                                                                                                                                                              |
| RISK-009 | Medium   | Canonical URL points to missing route      | `src/app/(app)/[tenantSlug]/(base-layout)/settings/branding/page.tsx` | Yes       | —                                                                                                                                                              |
| RISK-010 | Medium   | Two colour engines; brandCssVars unused    | `src/components/shared/layout/brand-theme.tsx`                        | Yes       | —                                                                                                                                                              |
| RISK-011 | Low      | Hex/slug rules and limits duplicated       | `src/features/branding/schemas/branding.ts`                           | Yes       | —                                                                                                                                                              |
| RISK-012 | Low      | Dead code in editor and helpers            | `src/features/branding/components/branding-editor.tsx`                | Yes       | —                                                                                                                                                              |
| RISK-013 | Low      | Replaced logos never deleted               | `src/features/branding/services/branding.service.ts`                  | Yes       | —                                                                                                                                                              |
| RISK-014 | Low      | Show-logo switch ignored by portal         | `src/features/portal/components/portal-shell.tsx`                     | No        | Deferred — user asked to wire the portal later (2026-10-15)                                                                                                    |

> Update the **Completed** column as you fix each item. If a risk will not be fixed, replace `_Pending_` with the reason (for example: "Deferred to Q3 — requires auth refactor" or "Accepted risk — internal admin page only").
