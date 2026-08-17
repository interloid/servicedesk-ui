import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tenantSlug: string }> }
) {
  const { tenantSlug } = await context.params;
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  const next =
    searchParams.get("next") ?? `/tenant/${tenantSlug}/reset-password`;

  if (code) {
    const cookieStore = await cookies();

    let response = NextResponse.redirect(`${origin}${next}`);

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });

            response = NextResponse.redirect(`${origin}${next}`);
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return response;
    }

    console.error("[SUPABASE_CALLBACK_ERROR]:", error.message);

    const errorUrl = new URL(`/tenant/${tenantSlug}/login`, origin);
    errorUrl.searchParams.set(
      "error",
      error.message || "Authentication failed"
    );
    return NextResponse.redirect(errorUrl);
  }

  const missingCodeUrl = new URL(`/tenant/${tenantSlug}/login`, origin);
  missingCodeUrl.searchParams.set("error", "Missing authentication code");
  return NextResponse.redirect(missingCodeUrl);
}