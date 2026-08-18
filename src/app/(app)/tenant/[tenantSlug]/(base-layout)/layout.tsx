import { AppFooter } from "@/components/shared/layout/app-footer";
import { AppHeader } from "@/components/shared/layout/app-header";
import { AppSidebar } from "@/components/shared/layout/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { getShellIdentity } from "@/lib/identity";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await getShellIdentity();

  return (
    <SidebarProvider className="w-full">
      <div className="flex h-screen w-full overflow-hidden bg-background text-xs text-slate-800 font-sans antialiased">
        <AppSidebar identity={identity} />

        <div className="flex flex-1 flex-col min-w-0 h-screen w-full">
          <AppHeader identity={identity} />
          <main className="flex-1 overflow-y-auto w-full p-6 md:p-8">
            {children}
          </main>
          <AppFooter identity={identity} />
        </div>
      </div>
    </SidebarProvider>
  );
}
