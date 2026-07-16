import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

export const routing = defineRouting({
  // All locales get a URL prefix: /en/dashboard, /zh-CN/dashboard, /zh-TW/dashboard
  locales: ["en", "zh-CN", "zh-TW"],
  defaultLocale: "en",
  localePrefix: "always",
});

// Lightweight wrappers around Next.js navigation APIs
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
