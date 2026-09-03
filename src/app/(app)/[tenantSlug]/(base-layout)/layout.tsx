import { AppFooter } from "@/components/shared/layout/app-footer";
import { AppHeader } from "@/components/shared/layout/app-header";
import { AppSidebar } from "@/components/shared/layout/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getShellIdentity } from "@/lib/identity";
import { fetchCurrentUserNotifications } from "@/lib/notifications.service";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{
    tenantSlug: string;
  }>;
}) {
  const { tenantSlug } = await params;

  const [identity, notifications] = await Promise.all([
    getShellIdentity(tenantSlug),
    fetchCurrentUserNotifications(tenantSlug),
  ]);

  return (
    <SidebarProvider className="w-full">
      <TooltipProvider delayDuration={0}>
        <div className="flex h-screen w-full overflow-hidden bg-background text-xs text-slate-800 font-sans antialiased">
          <AppSidebar identity={identity} />

          <div className="flex flex-1 flex-col min-w-0 h-full w-full">
            <AppHeader
              identity={identity}
              notifications={notifications}
              tenantSlug={tenantSlug}
            />

            <main className="flex-1 overflow-y-auto w-full p-6 mb-10 md:p-8 ">
              {children}
            </main>

            <AppFooter identity={identity} />
          </div>
        </div>
      </TooltipProvider>
    </SidebarProvider>
  );
}
