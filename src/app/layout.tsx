import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { siteConfig } from "@/config/site";
import "./globals.css";
import { cn } from "@/lib/utils";


const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

// The design uses mono for anything a user might copy — ticket IDs, amounts, IPs,
// DNS records, API keys, axis labels. Self-hosted by next/font, which is what makes
// it reachable at all: the design's own _ds/…/fonts.css pulls both faces from Google
// Fonts, and this app's CSP is `font-src 'self'`. Same `variable` indirection as Inter.
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: siteConfig.name,
    title: siteConfig.name,
    description: siteConfig.description,
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description: siteConfig.description,
    ...(siteConfig.twitterHandle ? { site: siteConfig.twitterHandle } : {}),
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the pre-hydration theme script (below) mutates the
    // <html> class and color-scheme before React hydrates, so the server and client
    // markup for this element legitimately differ. Scoped to <html> only.
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("h-dvh", "antialiased", "font-sans", inter.variable, jetbrainsMono.variable)}
    >
      <body className="h-full">
        {/* Runs synchronously before first paint to set the theme class on <html>,
            preventing a flash of the wrong theme. See src/lib/theme.ts. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: siteConfig.name,
              description: siteConfig.description,
              url: siteConfig.url,
            }),
          }}
        />
        
          {children}
         
      </body>
    </html>
  );
}
