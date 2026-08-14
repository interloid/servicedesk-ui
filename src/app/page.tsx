import React from "react";
import Link from "next/link";
import {
  Ticket,
  Zap,
  ShieldCheck,
  Users,
  MessageSquare,
  BarChart3,
  ArrowRight,
  CheckCircle2,
  Globe,
  Headphones,
  Lock,
  Bot,
  Sparkles,
  TrendingUp,
  Cpu,
  Building2,
} from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans dark:bg-slate-950 dark:text-slate-100 flex flex-col justify-between">
      <header className="sticky top-0 z-50 w-full border-b border-slate-200/80 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/80">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2.5 font-bold text-lg text-slate-900 dark:text-white"
          >
            <div className="w-8 h-8 rounded-lg bg-[#0f6c44] text-white flex items-center justify-center font-bold text-sm shadow-xs">
              S
            </div>
            <span>ServiceDeskPro</span>
          </Link>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600 dark:text-slate-300">
            <a
              href="#features"
              className="hover:text-[#0f6c44] dark:hover:text-emerald-400 transition-colors"
            >
              Features
            </a>
            <a
              href="#trending-2026"
              className="hover:text-[#0f6c44] dark:hover:text-emerald-400 transition-colors flex items-center gap-1.5"
            >
              <span>2026 Trends</span>
              <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 text-[#0f6c44] dark:text-emerald-300 text-[10px] font-bold px-2 py-0.5 border border-emerald-200 dark:border-emerald-800">
                NEW
              </span>
            </a>
            <a
              href="#pricing"
              className="hover:text-[#0f6c44] dark:hover:text-emerald-400 transition-colors"
            >
              Pricing
            </a>
            <a
              href="#docs"
              className="hover:text-[#0f6c44] dark:hover:text-emerald-400 transition-colors"
            >
              Documentation
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-[#0f6c44] dark:text-slate-300 dark:hover:text-white transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/setup"
              className="px-4 py-2 text-sm font-medium text-white bg-[#0f6c44] hover:bg-[#0c5636] rounded-lg transition-colors shadow-xs"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <section className="relative px-6 pt-24 pb-16 max-w-5xl mx-auto text-center flex flex-col items-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-50 text-emerald-800 text-xs font-semibold border border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50 mb-6">
          <Sparkles className="w-3.5 h-3.5 text-[#0f6c44]" />
          Next-Gen AI-Powered Support Infrastructure
        </div>

        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white max-w-4xl leading-[1.15]">
          Supercharge your support with{" "}
          <span className="text-[#0f6c44] dark:text-emerald-400">
            ServiceDeskPro
          </span>
        </h1>

        <p className="mt-6 text-lg text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
          The all-in-one multi-tenant helpdesk platform equipped with 2026 AI
          copilots, automated ticket routing, and dedicated organization
          workspaces.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <Link
            href="/setup"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-[#0f6c44] hover:bg-[#0c5636] text-white font-medium text-sm transition-all shadow-md hover:shadow-lg"
          >
            Create Your Workspace <ArrowRight className="w-4 h-4" />
          </Link>
          <a
            href="#pricing"
            className="inline-flex items-center justify-center px-6 py-3 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-medium text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
          >
            View Plans & Pricing
          </a>
        </div>
      </section>

      <section
        id="trending-2026"
        className="py-20 bg-white dark:bg-slate-900 border-y border-slate-200/80 dark:border-slate-800"
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col items-center text-center max-w-2xl mx-auto mb-16">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-[#0f6c44] text-xs font-semibold border border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50 mb-3">
              <TrendingUp className="w-3.5 h-3.5" /> 2026 Industry Standards
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white">
              Stay Ahead with 2026 Helpdesk Trends
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">
              ServiceDeskPro comes pre-configured with modern AI and proactive
              ticket resolution standards.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 hover:border-emerald-500/50 transition-all">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-[#0f6c44] flex items-center justify-center mb-4 dark:bg-emerald-950 dark:text-emerald-300">
                <Bot className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-2">
                Autonomous Agent Copilots
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                AI agents pre-draft response options, summarize multi-page
                customer histories in seconds, and resolve standard Level-1
                tickets autonomously.
              </p>
            </div>

            <div className="p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 hover:border-emerald-500/50 transition-all">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-[#0f6c44] flex items-center justify-center mb-4 dark:bg-emerald-950 dark:text-emerald-300">
                <Cpu className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-2">
                Predictive SLA Breach Alerts
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Real-time machine learning models analyze agent queue velocity
                and alert supervisors before SLA breaches happen, not after.
              </p>
            </div>

            <div className="p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 hover:border-emerald-500/50 transition-all">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-[#0f6c44] flex items-center justify-center mb-4 dark:bg-emerald-950 dark:text-emerald-300">
                <Globe className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-2">
                Zero-Trust Multi-Tenancy
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Complete dynamic subdomain isolation, database row-level tenant
                security, and real-time compliance tracking out of the box.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="features"
        className="py-20 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800"
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-xl mx-auto mb-16">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
              Built for modern customer operations
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              Everything your support team needs to handle issues faster and
              smarter.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-6 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 text-[#0f6c44] flex items-center justify-center mb-4 dark:bg-emerald-950 dark:text-emerald-300">
                <Ticket className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-slate-800 dark:text-white mb-1">
                Omnichannel Ticketing
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Consolidate requests from email, web portals, and API
                integrations into a unified, prioritizeable queue.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 text-[#0f6c44] flex items-center justify-center mb-4 dark:bg-emerald-950 dark:text-emerald-300">
                <Globe className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-slate-800 dark:text-white mb-1">
                Dedicated Tenant Domains
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Give your organization its own branded subdomain (e.g.,{" "}
                <code>yourcompany.servicedeskpro.com</code>).
              </p>
            </div>

            <div className="p-6 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 text-[#0f6c44] flex items-center justify-center mb-4 dark:bg-emerald-950 dark:text-emerald-300">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-slate-800 dark:text-white mb-1">
                Security & Role Control
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Keep client data isolated with strict multi-tenant security
                policies, SSO integration, and full audit logging.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="py-20 max-w-7xl mx-auto px-6 w-full">
        <div className="text-center max-w-xl mx-auto mb-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            Transparent plans for teams of any size
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
            Start free, scale with Pro, or power large enterprise operations
            with our Business plan.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          <div className="p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">
                Starter Workspace
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Ideal for startups & small support teams.
              </p>
              <div className="mt-6 text-3xl font-extrabold text-slate-900 dark:text-white">
                $0{" "}
                <span className="text-xs font-normal text-slate-400">
                  / workspace / mo
                </span>
              </div>
              <ul className="mt-6 space-y-3 text-xs text-slate-600 dark:text-slate-400">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#0f6c44] shrink-0" />
                  Custom Subdomain Included
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#0f6c44] shrink-0" />
                  Up to 3 Agent Seats
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#0f6c44] shrink-0" />
                  Standard Ticket Queue & Views
                </li>
              </ul>
            </div>
            <Link
              href="/setup"
              className="mt-8 w-full py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-center text-slate-800 dark:text-white transition-colors"
            >
              Start Free Today
            </Link>
          </div>

          <div className="p-8 rounded-2xl border-2 border-[#0f6c44] bg-white dark:bg-slate-900 flex flex-col justify-between relative shadow-lg">
            <div className="absolute -top-3 right-6 bg-[#0f6c44] text-white text-[10px] font-bold tracking-widest px-2.5 py-0.5 rounded-full uppercase">
              Most Popular
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">
                Pro Operations
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                For growing businesses needing automation & SLAs.
              </p>
              <div className="mt-6 text-3xl font-extrabold text-slate-900 dark:text-white">
                $29{" "}
                <span className="text-xs font-normal text-slate-400">
                  / agent / mo
                </span>
              </div>
              <ul className="mt-6 space-y-3 text-xs text-slate-600 dark:text-slate-400">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#0f6c44] shrink-0" />
                  Unlimited Agent Seats
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#0f6c44] shrink-0" />
                  Automated SLA Rules & Escalations
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#0f6c44] shrink-0" />
                  AI Copilot & Smart Ticket Triage
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#0f6c44] shrink-0" />
                  REST API & Webhook Access
                </li>
              </ul>
            </div>
            <Link
              href="/setup"
              className="mt-8 w-full py-2.5 rounded-lg bg-[#0f6c44] hover:bg-[#0c5636] text-xs font-semibold text-center text-white transition-colors shadow-xs"
            >
              Start 14-Day Free Trial
            </Link>
          </div>

          <div className="p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#0f6c44]" />
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">
                  Business Plan
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Custom infrastructure for high-scale organizations.
              </p>
              <div className="mt-6 text-3xl font-extrabold text-slate-900 dark:text-white">
                $59{" "}
                <span className="text-xs font-normal text-slate-400">
                  / agent / mo
                </span>
              </div>
              <ul className="mt-6 space-y-3 text-xs text-slate-600 dark:text-slate-400">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#0f6c44] shrink-0" />
                  Custom Domain Mapping (SSL)
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#0f6c44] shrink-0" />
                  SAML SSO & Okta/Azure AD
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#0f6c44] shrink-0" />
                  Dedicated DB Isolation & Backup
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#0f6c44] shrink-0" />
                  24/7 Priority SLA & Account Manager
                </li>
              </ul>
            </div>
            <Link
              href="/contact-sales"
              className="mt-8 w-full py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-center text-slate-800 dark:text-white transition-colors"
            >
              Contact Sales
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-950 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
            <div className="w-5 h-5 rounded bg-[#0f6c44] text-white flex items-center justify-center font-bold text-[10px]">
              S
            </div>
            <span>ServiceDeskPro Platform</span>
          </div>
          <p>
            © {new Date().getFullYear()} ServiceDeskPro. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
