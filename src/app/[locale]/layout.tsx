import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { Inter, Noto_Sans_SC, Noto_Sans_TC } from "next/font/google";
import { routing } from "@/i18n/routing";
import "@/app/globals.css";
import { Navbar } from "@/components/layout/navbar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { ThemeProvider } from "@/components/providers/theme-provider";
import AuthProvider from "@/components/providers/session-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-sc",
  display: "swap",
});

const notoSansTC = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-tc",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string };
}) {
  const t = await getTranslations({ locale, namespace: "metadata" });

  return {
    title: t("title"),
    description: t("description"),
    manifest: "/manifest.json",
    icons: {
      icon: [
        { url: "/icon.svg", type: "image/svg+xml" },
        { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
        { url: "/icon-192x192-maskable.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512x512-maskable.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/icon-192x192.png", sizes: "192x192", type: "image/png" }],
    },
  };
}

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#2563eb",
};

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const messages = await getMessages();

  // Determine which font classes to apply based on locale
  const fontClass =
    locale === "zh-CN"
      ? `${inter.variable} ${notoSansSC.variable}`
      : locale === "zh-TW"
        ? `${inter.variable} ${notoSansTC.variable}`
        : inter.variable;

  // Build explicit font-family per locale to ensure reliable rendering
  const fontFamily =
    locale === "zh-CN"
      ? "var(--font-inter), var(--font-noto-sans-sc), system-ui, sans-serif"
      : locale === "zh-TW"
        ? "var(--font-inter), var(--font-noto-sans-tc), system-ui, sans-serif"
        : "var(--font-inter), system-ui, sans-serif";

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={fontClass} style={{ fontFamily }}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            <AuthProvider>
              <Navbar />
              <MobileNav />
              <main className="min-h-screen bg-background pb-16 md:pb-0">{children}</main>
            </AuthProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
