import { env } from "@/config/env";

export const siteConfig = {
  url: env.NEXT_PUBLIC_SITE_URL,
  name: env.NEXT_PUBLIC_SITE_NAME,
  description: env.NEXT_PUBLIC_SITE_DESCRIPTION,
  twitterHandle: env.NEXT_PUBLIC_TWITTER_HANDLE,
};
