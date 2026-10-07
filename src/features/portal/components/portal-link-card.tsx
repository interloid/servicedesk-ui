"use client";

import type { ReactNode } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

const CARD = "rounded-2xl border bg-card shadow-xs";

const DEFAULT_DESCRIPTION =
  "Share this link with customers so they can create their own account and access support.";

export type PortalLinkContentProps = {
  /** Absolute portal URL, built on the server so the origin is trustworthy. */
  url: string;
  title?: string;
  description?: ReactNode;
  /** Adds "Open portal" beside the copy button. */
  showOpen?: boolean;
  /** Room for a secondary control, e.g. sending the link by email. */
  action?: ReactNode;
};

/**
 * The workspace's public portal address, with the two things an admin does
 * with it: copy it, or open it.
 *
 * Deliberately a link and not a button that mails something. This is the
 * public front door, so anyone who has it can sign themselves up -- there is
 * no token in it, and nothing here grants access. Handing it over is the same
 * act as putting it in a signature; the only difference is who does the
 * pasting. Anything that does create access (an invite, a sign-in link) is a
 * separate, explicit action elsewhere in the app.
 *
 * The URL is shown as selectable text rather than hidden behind the button,
 * because the commonest use is reading it out over a call or pasting it into
 * a different tool, and a copy button is the only route there when the
 * clipboard is unavailable.
 *
 * Borderless, so it can drop inside a card that already exists. PortalLinkCard
 * wraps it for a page that gives it a card of its own.
 */
export function PortalLinkContent({
  url,
  title = "Customer Portal",
  description = DEFAULT_DESCRIPTION,
  showOpen = false,
  action,
}: PortalLinkContentProps) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Portal link copied to your clipboard.");
    } catch {
      // Clipboard access is refused in plenty of ordinary situations -- an
      // insecure origin, a denied permission, an old browser -- and the text
      // is on screen either way, so point at the way out rather than just
      // reporting failure.
      toast.error("We couldn't copy that. Select the link and copy it.");
    }
  }

  return (
    <div>
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {/* break-all rather than truncate: a portal URL is long and there is
            nothing to infer from a cut-off host, so wrapping beats hiding
            the part the reader needs. */}
        <p className="min-w-0 flex-1 break-all text-sm font-semibold text-brand-ink">
          {url}
        </p>

        <div className="flex shrink-0 items-center gap-2">
          {action}
          {showOpen ? (
            <Button asChild variant="outline" size="sm" className="h-8">
              <a href={url} target="_blank" rel="noopener noreferrer">
                Open portal
                <ExternalLink aria-hidden className="size-3.5" />
              </a>
            </Button>
          ) : null}
          <Button variant="outline" size="sm" className="h-8" onClick={copy}>
            <Copy aria-hidden className="size-3.5" />
            {showOpen ? "Copy URL" : "Copy"}
          </Button>
        </div>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

/** The same content in a card of its own, for a page with room to give it. */
export function PortalLinkCard(props: PortalLinkContentProps) {
  return (
    <section className={CARD}>
      <div className="p-5 sm:p-6">
        <PortalLinkContent {...props} />
      </div>
    </section>
  );
}
