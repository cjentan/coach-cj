"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/routing";
import { MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import CoachChat from "@/components/coach/coach-chat";
import {
  type PageContext,
  detectPageContext,
} from "@/lib/page-context";
import { COACH_CHAT_EVENTS } from "@/lib/coach-chat-events";

export default function FloatingCoachButton() {
  const t = useTranslations("coach");
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const openTimeRef = useRef<number>(0);

  // Determine page context — captured once when the panel opens
  const handleOpen = useCallback(() => {
    const ctx = detectPageContext(pathname);
    setPageContext(ctx);
    setOpen(true);
    openTimeRef.current = Date.now();
  }, [pathname]);

  const handleClose = useCallback(() => {
    setOpen(false);
    // Keep the page context so the panel still has it during close animation
  }, []);

  // Escape key to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, handleClose]);

  // Body scroll lock when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Listen for external requests to open the coach panel (e.g. from Training Plan page)
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      setPendingAction(e.detail?.startInterview ? "start-interview" : null);
      handleOpen();
    };
    window.addEventListener(COACH_CHAT_EVENTS.OPEN, handler as EventListener);
    return () =>
      window.removeEventListener(COACH_CHAT_EVENTS.OPEN, handler as EventListener);
  }, [handleOpen]);

  // Don't render while auth is loading or not authenticated
  if (status !== "authenticated" || !session?.user) {
    return null;
  }

  // Don't render on hidden pages
  const ctx = detectPageContext(pathname);
  if (ctx === null) {
    return null;
  }

  return (
    <>
      {/* Floating action button */}
      <Button
        size="icon"
        onClick={handleOpen}
        className="fixed bottom-24 right-4 z-[55] h-12 w-12 rounded-full shadow-lg
                   md:bottom-6 md:right-6
                   bg-primary text-primary-foreground hover:bg-primary/90"
        aria-label={t("floatingButton")}
        title={t("floatingButton")}
      >
        <MessageCircle className="h-5 w-5" />
      </Button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 transition-opacity duration-300"
          onClick={handleClose}
          aria-hidden="true"
        />
      )}

      {/* Slide-in panel */}
      <div
        className={`fixed right-0 top-0 h-full w-full sm:w-[26.25rem] z-[61] bg-background shadow-xl
                    transform transition-transform duration-300 ease-in-out flex flex-col
                    ${open ? "translate-x-0" : "translate-x-full"}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
      >
        {/* Panel header — close button */}
        <div className="flex items-center justify-end px-4 pt-3 pb-0">
          <Button
            variant="ghost"
            onClick={handleClose}
            className="h-8 text-sm"
            aria-label={t("closePanel")}
          >
            <X className="h-4 w-4 mr-1" />
            {t("closePanel")}
          </Button>
        </div>

        {/* Coach Chat — fills remaining space */}
        <div className="flex-1 overflow-hidden">
          <CoachChat
            variant="floating"
            onClose={handleClose}
            pageContext={pageContext}
            pendingAction={pendingAction}
            onPendingActionHandled={() => setPendingAction(null)}
          />
        </div>
      </div>
    </>
  );
}
