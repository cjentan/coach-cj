"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Activity, Shield, Menu, X } from "lucide-react";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/training-logs", label: "Training" },
  { href: "/duplicates", label: "Duplicates" },
  { href: "/ingestion", label: "Import" },
  { href: "/settings", label: "Settings" },
];

export function Navbar() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 hidden md:block">
      <div className="mx-auto flex h-14 items-center justify-between px-4 max-w-6xl">
        <Link href={session?.user ? "/dashboard" : "/"} className="flex items-center gap-2 font-bold text-lg shrink-0" onClick={() => setMenuOpen(false)}>
          <Activity className="h-5 w-5 text-primary" />
          <span>Coach</span>
        </Link>

        {/* Desktop nav */}
        {session?.user ? (
          <>
            <nav className="hidden md:flex items-center gap-1 lg:gap-3">
              {NAV_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="text-xs lg:text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
                  {l.label}
                </Link>
              ))}
              {isAdmin && (
                <Link href="/admin" className="text-xs lg:text-sm font-medium hover:text-primary transition-colors flex items-center gap-1">
                  <Shield className="h-3 w-3" /> Admin
                </Link>
              )}
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => signOut({ redirectTo: "/" })}>
                Sign Out
              </Button>
            </nav>
            {/* Mobile hamburger */}
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMenuOpen(!menuOpen)}>
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </>
        ) : (
          <nav className="flex items-center gap-2">
            <Link href="/auth/signin"><Button variant="ghost" size="sm">Sign In</Button></Link>
            <Link href="/auth/signup"><Button size="sm">Get Started</Button></Link>
          </nav>
        )}
      </div>

      {/* Mobile menu */}
      {menuOpen && session?.user && (
        <div className="md:hidden border-t bg-background">
          <nav className="flex flex-col px-4 py-2">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="py-2.5 text-sm font-medium hover:text-primary transition-colors border-b last:border-0"
                onClick={() => setMenuOpen(false)}
              >
                {l.label}
              </Link>
            ))}
            {isAdmin && (
              <Link href="/admin" className="py-2.5 text-sm font-medium hover:text-primary transition-colors flex items-center gap-1 border-b" onClick={() => setMenuOpen(false)}>
                <Shield className="h-3 w-3" /> Admin
              </Link>
            )}
            <Button variant="ghost" size="sm" className="justify-start px-0 mt-1 text-sm" onClick={() => signOut({ redirectTo: "/" })}>
              Sign Out
            </Button>
          </nav>
        </div>
      )}
    </header>
  );
}
