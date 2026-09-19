"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

import { APP_ROUTES } from "@/lib/routes";

export function SiteHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/80 bg-background/80 backdrop-blur-md transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-bold text-base sm:text-lg text-foreground hover:opacity-90 transition-opacity shrink-0"
        >
          <span className="w-8 h-8 rounded-lg bg-brand-accent text-primary-foreground flex items-center justify-center font-bold text-sm shadow-xs shrink-0">
            S
          </span>
          <span className="tracking-tight">ServiceDeskPro</span>
        </Link>

        <nav className="hidden lg:flex items-center gap-6 xl:gap-8 text-sm font-medium text-muted-foreground">
          <a
            href="#features"
            className="hover:text-foreground text-foreground transition-colors py-1"
          >
            Features
          </a>
          <a
            href="#trending-2026"
            className="hover:text-foreground text-foreground transition-colors py-1 flex items-center gap-1.5"
          >
            <span>2026 Trends</span>
            <span className="rounded-full bg-brand-accent/10 text-brand-accent text-[10px] font-bold px-2 py-0.5 border border-brand-accent/20">
              NEW
            </span>
          </a>
          <a
            href="#pricing"
            className="hover:text-foreground text-foreground transition-colors py-1"
          >
            Pricing
          </a>
          <a
            href="#docs"
            className="hover:text-foreground text-foreground transition-colors py-1"
          >
            Documentation
          </a>
        </nav>

        <div className="hidden lg:flex items-center gap-3 shrink-0">
          <Link
            href={APP_ROUTES.LOGIN}
            className="px-3.5 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Log in
          </Link>
          <Link
            href={APP_ROUTES.SETUP}
            className="px-4 py-2 text-sm font-medium text-primary-foreground bg-brand-accent hover:bg-brand-accent/90 rounded-lg transition-all shadow-xs hover:shadow whitespace-nowrap"
          >
            Get Started
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="lg:hidden p-2 -mr-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus:outline-hidden focus:ring-2 focus:ring-brand-accent/50"
          aria-label="Toggle Navigation Menu"
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? (
            <X className="w-6 h-6" />
          ) : (
            <Menu className="w-6 h-6" />
          )}
        </button>
      </div>

      {mobileMenuOpen && (
        <div className="lg:hidden border-b border-border bg-background/95 backdrop-blur-lg px-4 sm:px-6 pt-3 pb-6 space-y-4 shadow-lg animate-in slide-in-from-top-2 duration-200">
          <nav className="flex flex-col space-y-1 text-sm font-medium text-muted-foreground">
            <a
              href="#features"
              onClick={closeMobileMenu}
              className="px-3 py-2.5 text-foreground rounded-lg hover:text-foreground hover:bg-muted transition-colors"
            >
              Features
            </a>
            <a
              href="#trending-2026"
              onClick={closeMobileMenu}
              className="px-3 py-2.5 rounded-lg text-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-between"
            >
              <span>2026 Trends</span>
              <span className="rounded-full bg-brand-accent/10 text-brand-accent text-[10px] font-bold px-2 py-0.5 border border-brand-accent/20">
                NEW
              </span>
            </a>
            <a
              href="#pricing"
              onClick={closeMobileMenu}
              className="px-3 py-2.5 rounded-lg text-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Pricing
            </a>
            <a
              href="#docs"
              onClick={closeMobileMenu}
              className="px-3 py-2.5 rounded-lg text-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Documentation
            </a>
          </nav>

          <div className="pt-3 border-t border-border flex flex-col gap-2.5">
            <Link
              href={APP_ROUTES.LOGIN}
              onClick={closeMobileMenu}
              className="w-full text-center px-4 py-2.5 text-sm font-medium text-foreground bg-muted/50 hover:bg-muted border border-border/80 rounded-lg transition-colors"
            >
              Log in
            </Link>
            <Link
              href={APP_ROUTES.SETUP}
              onClick={closeMobileMenu}
              className="w-full text-center px-4 py-2.5 text-sm font-medium text-primary-foreground bg-brand-accent hover:bg-brand-accent/90 rounded-lg shadow-xs transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
