import { AppFooter } from "@/components/shared/layout/app-footer";
import { AppHeader } from "@/components/shared/layout/app-header";
import { AppSidebar } from "@/components/shared/layout/app-sidebar";
import { RoleRouteGuard } from "@/components/shared/layout/role-route-guard";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getShellIdentity } from "@/lib/identity";
import { APP_ROUTES } from "@/lib/routes";
import { isStaffRole } from "@/lib/tenancy";
import { notFound, redirect } from "next/navigation";

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

  // getShellIdentity returns null for a failed claims lookup, a session whose
  // tenant does not match the URL, or a tenant row RLS will not return. Without
  // this the shell renders with customer navigation, which fails open.
  //
  // Deliberately notFound() and not a redirect to the tenant login: the proxy
  // bounces an authenticated visitor off /[slug]/login back to /[slug]/tickets
  // (see allowsExistingSession in lib/tenancy.ts), so redirecting there would
  // loop forever for exactly the broken sessions this guard catches.
  if (!identity) {
    notFound();
  }

  // Backstop for the proxy's customer check. A customer does have a live
  // membership, so getShellIdentity resolves for them and `identity` is not
  // null -- without this the dashboard renders on a customer's session if the
  // proxy is ever bypassed. /unauthorized is a central, tenant-less path, so it
  // cannot bounce back in here.
  if (!isStaffRole(identity.user.role)) {
    redirect(
      `${APP_ROUTES.UNAUTHORIZED}?tenant=${encodeURIComponent(tenantSlug)}`,
    );
  }

  return (
    <SidebarProvider className="w-full">
      <TooltipProvider delayDuration={0}>
        <RoleRouteGuard role={identity.user.role} />
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
