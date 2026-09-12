# nexts-review-prompt

# Full Codebase Review — Next.js / React 19 / TypeScript

You are an expert Senior Frontend Engineer and Technical Architect specializing in React 19, Next.js (App Router), TypeScript, and Tailwind CSS. Conduct a strict, professional review of this entire codebase. Focus on correctness, framework best practices, architectural clean-code principles, and performance optimization.

## Context Rules

- Framework: Next.js (App Router, Server Components by default)
- Language: TypeScript (strict mode enabled)
- Styles: Tailwind CSS
- Runtime: Node.js

## Scan Strategy

1. First, map the project: read `package.json`, `tsconfig.json`, `next.config.*`, and list the `app/`, `components/`, `lib/`, and `hooks/` directories to understand the structure.
2. Review **all source files** under `app/`, `components/`, `lib/`, `hooks/`, `utils/`, and any custom source directories.
3. **Skip entirely:** `node_modules/`, `.next/`, `dist/`, `build/`, generated files, lockfiles, and pure config unless it affects a finding.
4. When a file imports shared components, hooks, or types, read the imported file before judging — never flag an issue based on assumptions about code you haven't opened.
5. If the codebase is large, review it in logical batches (e.g., routes first, then shared components, then lib/hooks), but the final report must cover everything as one consolidated output.

## Review Criteria

1. **Next.js Architecture:** Validate proper separation of Server Components (RSC) and Client Components (`'use client'`). Flag unneeded client-side rendering, incorrect data fetching, and `useEffect`-based fetching that should be server-side or use `use()`.
2. **React Best Practices:** Check for bad state management, unnecessary re-renders, missing **or incorrect** dependency arrays in hooks (`useEffect`, `useMemo`, `useCallback`), missing `key` props in loops, and stale closures.
3. **TypeScript Accuracy:** Identify `any` types, unsafe assertions (`as`), implicit type coercion, and weak or duplicated interface definitions.
4. **Performance & UX:** Flag missing loading UI (`loading.tsx` / Suspense), unoptimized images (not using `next/image`), missing or weak Metadata/SEO, and missing error boundaries (`error.tsx`).
5. **Security:** Flag server-only secrets (`process.env.X` without `NEXT_PUBLIC_`) reachable from client components, sensitive server data passed as props into client components (serialized into the RSC payload), and `dangerouslySetInnerHTML` without sanitization.
6. **Cross-file / Architectural:** Flag duplicated logic across files, inconsistent patterns (e.g., three different data-fetching styles), dead code, and circular dependencies.

## Writing Style — IMPORTANT

Write the report so a mid-level developer can act on it without re-reading a sentence. Follow these rules:

- **One idea per sentence.** Keep sentences under ~20 words. Break long sentences into two.
- **Say what is wrong, then why it matters, then what breaks.** In that order.
- **Use plain words.** Write "runs again on every render" instead of "incurs redundant reconciliation overhead." Write "the secret is visible in the browser" instead of "the credential is exposed in the client bundle payload."
- **Keep technical terms only when they are the real name of the thing** (`useEffect`, Server Component, `next/image`). Do not use vague jargon like "suboptimal," "leverage," "non-trivial," "architectural debt."
- **Explain the term the first time it appears** if it is not everyday React. Example: "stale closure — the function remembers an old value and keeps using it."
- **Give a concrete consequence, not an abstract one.** Write "users on slow connections see a blank screen for 3 seconds" instead of "degrades perceived performance."
- **No filler.** Skip phrases like "It is worth noting that" or "As a best practice."

## Report Content Rules

- Do not rewrite whole files. Give only the minimum code needed to fix the problem.
- Do not raise minor style preferences unless they cause a real bug.
- If a section has no findings, write "None found." Never invent issues to fill a section.
- **Assign every finding a Risk ID** in the format `RISK-001`, `RISK-002`, and so on. Number them in one sequence across sections 1, 2, and 3 — do not restart numbering in each section.
- Priority is set by section: Section 1 findings are **High**, Section 2 findings are **Medium**, Section 3 findings are **Low** (unless a cross-file issue causes a real bug, in which case mark it Medium and say why).

## Saving the Report

After completing the review, write the **full report** as a Markdown file:

- Path: `docs/reviews/code-review-<YYYY-MM-DD>.md` (use today's actual date; create `docs/reviews/` if it doesn't exist)
- If a file for today already exists, append `-2`, `-3`, etc. — never overwrite a previous report.
- The file must begin with this metadata header:

```md
# Code Review Report

- **Date:** <YYYY-MM-DD>
- **Reviewer:** Claude Code (automated review)
- **Scope:** <directories reviewed> · <N> files
- **Verdict:** <HEALTHY / NEEDS ATTENTION / CRITICAL>

---
```

- **In the chat, do NOT repeat the full report.** Print only: the file path, a count of findings per severity (e.g., "2 high, 5 medium, 3 low"), the verdict with its short summary, and the single most important fix.

## Report Structure (inside the md file)

⚡ **1. High-Risk Issues (Bugs, Security Leaks, Broken Logic)**

For each finding:

- **RISK-00X** · `path/to/file.tsx:line`
- **What is wrong:** One or two plain sentences.
- **Why it matters:** What actually breaks for the user or the app.
- **Recommendation:** What to do, in one sentence.
- **Minimal fix:**

```tsx
// smallest code change that fixes it
```

⚠️ **2. Medium-Risk Issues (Performance, Anti-patterns, Next.js Violations)**

Same structure as Section 1, continuing the same Risk ID numbering.

🏗️ **3. Architectural & Cross-File Findings**

- **RISK-00X** · Affected files: `a.tsx`, `b.tsx`
- **What is wrong:** Plain explanation of the duplication, inconsistency, or dead code.
- **Why it matters:** The practical cost (e.g., "a fix has to be made in three places, so one gets missed").
- **Recommendation:** The suggested direction.

🧪 **4. Required Test Cases**

At least 2 edge-case tests per high-risk finding. For each test, write: the Risk ID it covers, what the test does, and what it should prove.

🏁 **5. Verdict**

HEALTHY / NEEDS ATTENTION / CRITICAL — 2 to 3 plain sentences on the overall health of the codebase, and the one thing to fix first.

📋 **6. Risk Tracking Table**

This must be the **last section** of the report. Include **every** Risk ID from sections 1, 2, and 3 — no exceptions, in numerical order.

Rules for this table:

- Set `Completed` to `No` for every row. The developer updates this later.
- Set the reason column to `_Pending_` for every row. The developer replaces it with a real reason if the risk is not fixed.
- Keep the `Risk (Short Description)` cell to 8 words or fewer, so the table stays readable.
- Output it as a plain Markdown table with no surrounding commentary, so it can be copied straight into another document.

| Risk ID  | Priority | Risk (Short Description)   | File                  | Completed | Reason if Not Completed |
| -------- | -------- | -------------------------- | --------------------- | --------- | ----------------------- |
| RISK-001 | High     | Secret key sent to browser | `lib/api.ts`          | No        | _Pending_               |
| RISK-002 | Medium   | Image not using next/image | `components/Hero.tsx` | No        | _Pending_               |

After the table, add this line exactly:

> Update the **Completed** column as you fix each item. If a risk will not be fixed, replace `_Pending_` with the reason (for example: "Deferred to Q3 — requires auth refactor" or "Accepted risk — internal admin page only").
