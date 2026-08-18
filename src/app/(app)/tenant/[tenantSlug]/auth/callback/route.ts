import { env } from "@/config/env";
import { withTenantPrefix, tenantPath, TENANT_ROUTES } from "@/lib/tenancy";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tenantSlug: string }> },
) {
  const { tenantSlug } = await context.params;
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");
  const targetPath = rawNext
    ? withTenantPrefix(tenantSlug, rawNext)
    : tenantPath(tenantSlug, TENANT_ROUTES.RESET_PASSWORD);

  if (code) {
    const cookieStore = await cookies();

    let response = NextResponse.redirect(`${origin}${targetPath}`);

    const supabase = createServerClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });

            response = NextResponse.redirect(`${origin}${targetPath}`);
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return response;
    }

    console.error("[SUPABASE_CALLBACK_ERROR]:", error.message);

    const errorUrl = new URL(
      tenantPath(tenantSlug, TENANT_ROUTES.LOGIN),
      origin,
    );
    errorUrl.searchParams.set(
      "error",
      error.message || "Authentication failed",
    );
    return NextResponse.redirect(errorUrl);
  }

  const missingCodeUrl = new URL(
    tenantPath(tenantSlug, tenantPath(tenantSlug, TENANT_ROUTES.LOGIN)),
    origin,
  );
  missingCodeUrl.searchParams.set("error", "Missing authentication code");
  return NextResponse.redirect(missingCodeUrl);
}
