export const APP_ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  SIGNUP: "/signup",
  CONTACT_SALES: "/contact-sales",
  FORGOT_PASSWORD: "/forgot-password",
  RESET_PASSWORD: "/reset-password",
  SETUP: "/setup",
  AUTH_CALLBACK: "/auth/callback",
  /**
   * Tenant-less, so it renders without the workspace shell -- which is the
   * whole point: a customer must never see the agent dashboard chrome. Kept
   * out of every tenant route (see RESERVED_LABELS) and treated as a central
   * path by the proxy, so it is reachable signed out and by a customer session.
   */
  UNAUTHORIZED: "/unauthorized",
} as const;
