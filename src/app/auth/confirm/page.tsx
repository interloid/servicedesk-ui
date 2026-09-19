import type { Metadata } from "next";

import { AuthConfirmHandler } from "./confirm-handler";

export const metadata: Metadata = {
  title: "Confirm your email",
  robots: { index: false, follow: false },
};

export default function ConfirmEmailPage() {
  return <AuthConfirmHandler />;
}
