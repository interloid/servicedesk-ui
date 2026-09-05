import { AppFooter } from "@/components/shared/layout/app-footer";
import { AppHeader } from "@/components/shared/layout/app-header";
import { AppSidebar } from "@/components/shared/layout/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getShellIdentity } from "@/lib/identity";

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

  const identity = await getShellIdentity(tenantSlug);

  return (
    <SidebarProvider className="w-full">
      <TooltipProvider delayDuration={0}>
        <div className="flex h-screen w-full overflow-hidden bg-background text-xs text-slate-800 font-sans antialiased">
          <AppSidebar identity={identity} />

          <div className="flex flex-1 flex-col min-w-0 h-full w-full">
            <AppHeader identity={identity} />

            <main className="flex-1 overflow-y-auto w-full  p-0 ">
              {children}
            </main>

            <AppFooter identity={identity} />
          </div>
        </div>
      </TooltipProvider>
    </SidebarProvider>
  );
}
