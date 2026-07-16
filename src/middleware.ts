import { NextResponse, NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Create the i18n middleware instance once (not inside auth wrapper)
const intlMiddleware = createMiddleware(routing);

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Bypass i18n for API routes, static files, and next internals
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // 1. Run i18n middleware first (locale detection + redirect to prefixed URL)
  const intlResponse = intlMiddleware(req);
  if (intlResponse) return intlResponse;

  // 2. Now apply auth rules using the locale-prefixed path
  const detectedLocale =
    routing.locales.find((l) => pathname.startsWith(`/${l}/`) || pathname === `/${l}`) ||
    routing.defaultLocale;
  const localePrefix = `/${detectedLocale}`;

  // Strip locale prefix to check the actual route
  let effectivePath = pathname;
  if (pathname.startsWith(localePrefix + "/")) {
    effectivePath = pathname.slice(localePrefix.length);
  } else if (pathname === localePrefix) {
    effectivePath = "/";
  }

  // Read session token directly from cookie (avoid auth() wrapper deadlock)
  const sessionToken =
    req.cookies.get("next-auth.session-token")?.value ||
    req.cookies.get("__Secure-next-auth.session-token")?.value;
  const isLoggedIn = !!sessionToken;

  const isAuthPage = effectivePath.startsWith("/auth/");
  const isPublic = effectivePath === "/";

  if (isAuthPage && isLoggedIn) {
    return NextResponse.redirect(new URL(`${localePrefix}/dashboard`, req.url));
  }
  if (!isLoggedIn && !isAuthPage && !isPublic) {
    return NextResponse.redirect(new URL(`${localePrefix}/auth/signin`, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
