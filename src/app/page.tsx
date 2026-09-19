import type { Metadata } from "next";
import Link from "next/link";
import {
  Ticket,
  ArrowRight,
  CheckCircle2,
  Globe,
  Lock,
  Bot,
  Sparkles,
  TrendingUp,
  Cpu,
  Building2,
} from "lucide-react";
import { APP_ROUTES } from "@/lib/routes";
import { SiteHeader } from "@/components/marketing/site-header";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Help desk built for teams that outgrew a shared inbox",
  description: siteConfig.description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: siteConfig.name,
    title: `${siteConfig.name} — help desk for growing support teams`,
    description: siteConfig.description,
  },
};

export default function Home() {
  return (
    <div className="min-h-dvh bg-background text-foreground font-sans flex flex-col justify-between selection:bg-brand-accent/20 selection:text-brand-accent">
      <SiteHeader />

      <main className="flex-1">
        <section className="relative px-4 sm:px-6 lg:px-8 pt-10 sm:pt-16 md:pt-24 pb-12 sm:pb-20 max-w-5xl mx-auto text-center flex flex-col items-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-accent/10 text-brand-accent text-xs font-semibold border border-brand-accent/20 mb-6 max-w-full">
            <Sparkles className="w-3.5 h-3.5 text-brand-accent shrink-0" />
            <span className="truncate">
              Next-Gen AI-Powered Support Infrastructure
            </span>
          </div>

          <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-foreground max-w-4xl leading-[1.12]">
            Supercharge your support with
            <span className="text-brand-accent inline-block">
              ServiceDeskPro
            </span>
          </h1>

          <p className="mt-4 sm:mt-6 text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed">
            The all-in-one multi-tenant helpdesk platform equipped with 2026 AI
            copilots, automated ticket routing, and dedicated organization
            workspaces.
          </p>

          <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 w-full sm:w-auto">
            <Link
              href={APP_ROUTES.SETUP}
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-brand-accent hover:bg-brand-accent/90 text-primary-foreground font-medium text-sm sm:text-base transition-all shadow-md hover:shadow-lg w-full sm:w-auto shrink-0"
            >
              <span>Create Your Workspace</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="#pricing"
              className="inline-flex items-center justify-center px-6 py-3.5 rounded-xl border border-border bg-card text-card-foreground hover:bg-muted font-medium text-sm sm:text-base transition-colors w-full sm:w-auto shrink-0"
            >
              View Plans & Pricing
            </a>
          </div>
        </section>

        <section
          id="trending-2026"
          className="py-12 sm:py-20 lg:py-24 bg-card border-y border-border"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center text-center max-w-2xl mx-auto mb-10 sm:mb-16">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-accent/10 text-brand-accent text-xs font-semibold border border-brand-accent/20 mb-3">
                <TrendingUp className="w-3.5 h-3.5 shrink-0" /> 2026 Industry
                Standards
              </div>
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-foreground tracking-tight">
                Stay Ahead with 2026 Helpdesk Trends
              </h2>
              <p className="text-xs sm:text-sm md:text-base text-muted-foreground mt-3">
                ServiceDeskPro comes pre-configured with modern AI and proactive
                ticket resolution standards.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-8">
              <div className="p-6 sm:p-8 rounded-2xl border border-border bg-muted/40 hover:border-brand-accent/50 transition-all flex flex-col justify-between">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-brand-accent/10 text-brand-accent flex items-center justify-center mb-5">
                    <Bot className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-base sm:text-lg text-foreground mb-2">
                    Autonomous Agent Copilots
                  </h3>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    AI agents pre-draft response options, summarize multi-page
                    customer histories in seconds, and resolve standard Level-1
                    tickets autonomously.
                  </p>
                </div>
              </div>

              <div className="p-6 sm:p-8 rounded-2xl border border-border bg-muted/40 hover:border-brand-accent/50 transition-all flex flex-col justify-between">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-brand-accent/10 text-brand-accent flex items-center justify-center mb-5">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-base sm:text-lg text-foreground mb-2">
                    Predictive SLA Breach Alerts
                  </h3>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    Real-time machine learning models analyze agent queue
                    velocity and alert supervisors before SLA breaches happen,
                    not after.
                  </p>
                </div>
              </div>

              <div className="p-6 sm:p-8 rounded-2xl border border-border bg-muted/40 hover:border-brand-accent/50 transition-all sm:col-span-2 lg:col-span-1 flex flex-col justify-between">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-brand-accent/10 text-brand-accent flex items-center justify-center mb-5">
                    <Globe className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-base sm:text-lg text-foreground mb-2">
                    Zero-Trust Multi-Tenancy
                  </h3>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    Complete dynamic subdomain isolation, database row-level
                    tenant security, and real-time compliance tracking out of
                    the box.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="features"
          className="py-12 sm:py-20 lg:py-24 bg-card border-b border-border"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-xl mx-auto mb-10 sm:mb-16">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-foreground tracking-tight">
                Built for modern customer operations
              </h2>
              <p className="text-xs sm:text-sm md:text-base text-muted-foreground mt-3">
                Everything your support team needs to handle issues faster and
                smarter.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-8">
              <div className="p-6 sm:p-8 rounded-xl border border-border bg-muted/40 hover:bg-muted/60 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-brand-accent/10 text-brand-accent flex items-center justify-center mb-5">
                  <Ticket className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-base sm:text-lg text-foreground mb-2">
                  Omnichannel Ticketing
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  Consolidate requests from email, web portals, and API
                  integrations into a unified, prioritizeable queue.
                </p>
              </div>

              <div className="p-6 sm:p-8 rounded-xl border border-border bg-muted/40 hover:bg-muted/60 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-brand-accent/10 text-brand-accent flex items-center justify-center mb-5">
                  <Globe className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-base sm:text-lg text-foreground mb-2">
                  Dedicated Tenant Domains
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  Give your organization its own branded subdomain (e.g.,
                  <code className="break-all bg-background px-1.5 py-0.5 rounded border border-border/60 font-mono text-[11px] sm:text-xs">
                    yourcompany.servicedeskpro.com
                  </code>
                  ).
                </p>
              </div>

              <div className="p-6 sm:p-8 rounded-xl border border-border bg-muted/40 hover:bg-muted/60 transition-colors sm:col-span-2 lg:col-span-1">
                <div className="w-10 h-10 rounded-xl bg-brand-accent/10 text-brand-accent flex items-center justify-center mb-5">
                  <Lock className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-base sm:text-lg text-foreground mb-2">
                  Security & Role Control
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  Keep client data isolated with strict multi-tenant security
                  policies, SSO integration, and full audit logging.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          id="pricing"
          className="py-12 sm:py-20 lg:py-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full"
        >
          <div className="text-center max-w-xl mx-auto mb-10 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-foreground tracking-tight">
              Transparent plans for teams of any size
            </h2>
            <p className="text-xs sm:text-sm md:text-base text-muted-foreground mt-3">
              Start free, scale with Pro, or power large enterprise operations
              with our Business plan.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8 max-w-6xl mx-auto items-stretch">
            <div className="p-6 sm:p-8 rounded-2xl border border-border bg-card text-card-foreground flex flex-col justify-between shadow-xs hover:border-brand-accent/30 transition-all">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-foreground">
                  Starter Workspace
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  Ideal for startups & small support teams.
                </p>
                <div className="mt-6 text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
                  $0
                  <span className="text-xs sm:text-sm font-normal text-muted-foreground">
                    / workspace / mo
                  </span>
                </div>
                <ul className="mt-6 space-y-3 text-xs sm:text-sm text-muted-foreground">
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-brand-accent shrink-0" />
                    <span>Custom Subdomain Included</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-brand-accent shrink-0" />
                    <span>Up to 3 Agent Seats</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-brand-accent shrink-0" />
                    <span>Standard Ticket Queue & Views</span>
                  </li>
                </ul>
              </div>
              <Link
                href={APP_ROUTES.SETUP}
                className="mt-8 w-full py-3 rounded-xl border border-border bg-muted/60 hover:bg-muted text-xs sm:text-sm font-semibold text-center text-foreground transition-colors block"
              >
                Start Free Today
              </Link>
            </div>

            <div className="p-6 sm:p-8 rounded-2xl border-2 border-brand-accent bg-card text-card-foreground flex flex-col justify-between relative shadow-lg lg:-translate-y-2">
              <div className="absolute -top-3.5 right-6 bg-brand-accent text-primary-foreground text-[10px] font-bold tracking-wider px-3 py-0.5 rounded-full uppercase shadow-xs">
                Most Popular
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-foreground">
                  Pro Operations
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  For growing businesses needing automation & SLAs.
                </p>
                <div className="mt-6 text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
                  $29
                  <span className="text-xs sm:text-sm font-normal text-muted-foreground">
                    / agent / mo
                  </span>
                </div>
                <ul className="mt-6 space-y-3 text-xs sm:text-sm text-muted-foreground">
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-brand-accent shrink-0" />
                    <span>Unlimited Agent Seats</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-brand-accent shrink-0" />
                    <span>Automated SLA Rules & Escalations</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-brand-accent shrink-0" />
                    <span>AI Copilot & Smart Ticket Triage</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-brand-accent shrink-0" />
                    <span>REST API & Webhook Access</span>
                  </li>
                </ul>
              </div>
              <Link
                href={APP_ROUTES.SETUP}
                className="mt-8 w-full py-3 rounded-xl bg-brand-accent hover:bg-brand-accent/90 text-xs sm:text-sm font-semibold text-center text-primary-foreground transition-colors shadow-xs block"
              >
                Start 14-Day Free Trial
              </Link>
            </div>

            <div className="p-6 sm:p-8 rounded-2xl border border-border bg-card text-card-foreground flex flex-col justify-between shadow-xs hover:border-brand-accent/30 transition-all">
              <div>
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-brand-accent shrink-0" />
                  <h3 className="text-base sm:text-lg font-bold text-foreground">
                    Business Plan
                  </h3>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  Custom infrastructure for high-scale organizations.
                </p>
                <div className="mt-6 text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
                  $59
                  <span className="text-xs sm:text-sm font-normal text-muted-foreground">
                    / agent / mo
                  </span>
                </div>
                <ul className="mt-6 space-y-3 text-xs sm:text-sm text-muted-foreground">
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-brand-accent shrink-0" />
                    <span>Custom Domain Mapping (SSL)</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-brand-accent shrink-0" />
                    <span>SAML SSO & Okta/Azure AD</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-brand-accent shrink-0" />
                    <span>Dedicated DB Isolation & Backup</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-brand-accent shrink-0" />
                    <span>24/7 Priority SLA & Account Manager</span>
                  </li>
                </ul>
              </div>
              <Link
                href={APP_ROUTES.LOGIN}
                className="mt-8 w-full py-3 rounded-xl border border-border bg-muted/60 hover:bg-muted text-xs sm:text-sm font-semibold text-center text-foreground transition-colors block"
              >
                Contact Sales
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-background py-8 sm:py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground text-center sm:text-left">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <span className="w-5 h-5 rounded bg-brand-accent text-primary-foreground flex items-center justify-center font-bold text-[10px] shrink-0">
              S
            </span>
            <span className="tracking-tight">ServiceDeskPro Platform</span>
          </div>
          <p>
            © {new Date().getFullYear()} ServiceDeskPro. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
