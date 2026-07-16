"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  NotebookText,
  Settings,
  MoreHorizontal,
  Copy,
  Upload,
  LogOut,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

export function MobileNav() {
  const { data: session } = useSession();
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isAdmin = session?.user?.role === "admin";

  const NAV_ITEMS = [
    { href: "/activities", label: t("activities"), icon: NotebookText },
    { href: "/dashboard", label: t("dashboard"), icon: LayoutDashboard, primary: true },
    { href: "#more", label: t("more"), icon: MoreHorizontal },
  ];

  const MORE_ITEMS = [
    { href: "/duplicates", label: t("duplicates"), icon: Copy },
    { href: "/ingestion", label: t("import"), icon: Upload },
    { href: "/settings", label: t("settings"), icon: Settings },
    ...(isAdmin ? [{ href: "/admin", label: t("admin"), icon: Shield }] : []),
    { label: t("signOut"), icon: LogOut, action: "signout" as const },
  ];

  if (!session?.user) return null;

  const isActive = (href: string) => {
    if (href === "#more") return moreOpen;
    if (href === "/activities") return pathname.startsWith("/activities");
    return pathname === "/dashboard" || pathname === "/";
  };

  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center justify-around h-16 px-4 max-w-lg mx-auto">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={(e) => {
                  if (item.href === "#more") {
                    e.preventDefault();
                    setMoreOpen(true);
                  }
                }}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors",
                  item.primary ? "h-14 w-14 -mt-3" : "h-12 w-16",
                  active
                    ? item.primary
                      ? "bg-primary text-primary-foreground shadow-lg"
                      : "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className={item.primary ? "h-6 w-6" : "h-5 w-5"} />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* More menu overlay */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 md:hidden"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="bg-background rounded-xl p-6 shadow-xl mx-4 w-64"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-2 gap-4">
              {MORE_ITEMS.map((item) => {
                const Icon = item.icon;
                if (item.action === "signout") {
                  return (
                    <button
                      key={item.label}
                      onClick={() => {
                        setMoreOpen(false);
                        signOut({ redirectTo: "/" });
                      }}
                      className="flex flex-col items-center gap-2 p-4 rounded-lg hover:bg-muted transition-colors"
                    >
                      <Icon className="h-8 w-8 text-muted-foreground" />
                      <span className="text-xs font-medium">{item.label}</span>
                    </button>
                  );
                }
                return (
                  <Link
                    key={item.href}
                    href={item.href!}
                    onClick={() => setMoreOpen(false)}
                    className="flex flex-col items-center gap-2 p-4 rounded-lg hover:bg-muted transition-colors"
                  >
                    <Icon className="h-8 w-8 text-primary" />
                    <span className="text-xs font-medium">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
