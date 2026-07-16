"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  Settings2,
  Target,
  Scale,
  Brain,
  Key,
  Plug,
  Shield,
  AlertTriangle,
} from "lucide-react";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("settings");
  const pathname = usePathname();

  const SIDEBAR_ITEMS = [
    { href: "/settings", label: t("general"), icon: Settings2 },
    { href: "/settings/goals", label: t("goals.title"), icon: Target },
    { href: "/settings/body-metrics", label: t("bodyMetrics.title"), icon: Scale },
    { href: "/settings/analysis", label: t("analysisTab"), icon: Brain },
    { href: "/settings/credentials", label: t("apiCredentials"), icon: Key },
    { href: "/settings/integrations", label: t("integrations.title"), icon: Plug },
    { href: "/settings/backup-restore", label: t("backupRestore.title"), icon: Shield },
    { href: "/settings/danger-zone", label: t("dangerZone.title"), icon: AlertTriangle },
  ];

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar — hidden on small screens */}
        <aside className="hidden md:block w-52 shrink-0">
          <nav className="space-y-1 sticky top-20">
            {SIDEBAR_ITEMS.map((item) => {
              const isActive =
                item.href === "/settings"
                  ? pathname === "/settings"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Mobile tab bar */}
        <div className="md:hidden w-full mb-4 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <nav className="flex gap-1 pb-2 border-b">
            {SIDEBAR_ITEMS.map((item) => {
              const isActive =
                item.href === "/settings"
                  ? pathname === "/settings"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Content */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
