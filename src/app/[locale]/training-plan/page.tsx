"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, CalendarDays, Sparkles, Trash2 } from "lucide-react";
import {
  startOfMonth,
  endOfMonth,
  parseISO,
  isWithinInterval,
} from "date-fns";
import { Button } from "@/components/ui/button";
import type { TrainingPlanResponse } from "@/lib/training-plan-types";
import { CalendarView } from "@/components/training-plan/calendar-view";
import { PhaseBar } from "@/components/training-plan/phase-bar";
import { PeriodSummary } from "@/components/training-plan/period-summary";
import { openCoachChat, COACH_CHAT_EVENTS } from "@/lib/coach-chat-events";

export default function TrainingPlanPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const tp = useTranslations("training-plan");
  const common = useTranslations("common");

  // ── State ─────────────────────────────────────────────
  const [planData, setPlanData] = useState<TrainingPlanResponse | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Auth guard ────────────────────────────────────────
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    }
  }, [status, router]);

  // ── Data fetch ────────────────────────────────────────
  const loadPlanData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/training-plan?tzOffset=${new Date().getTimezoneOffset()}`,
      );
      if (!res.ok) throw new Error(`${common("error")}: ${res.status}`);
      const data: TrainingPlanResponse = await res.json();
      setPlanData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : tp("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    loadPlanData();
  }, [status, loadPlanData]);

  // ── Derived data ──────────────────────────────────────
  const monthStart = useMemo(() => startOfMonth(currentMonth), [currentMonth]);
  const monthEnd = useMemo(() => endOfMonth(currentMonth), [currentMonth]);

  // Weeks overlapping the current month
  const monthWeeks = useMemo(() => {
    if (!planData) return [];
    return planData.weeks.filter((w) => {
      const ws = parseISO(w.weekStart);
      const we = parseISO(w.weekEnd);
      return ws <= monthEnd && we >= monthStart;
    });
  }, [planData, monthStart, monthEnd]);

  // Current week (the one containing today, or first week of month if today not in plan)
  const currentWeek = useMemo(() => {
    if (!planData) return null;
    const today = new Date();
    // Try to find the week that contains today
    const containingWeek = planData.weeks.find((w) => {
      const ws = parseISO(w.weekStart);
      const we = parseISO(w.weekEnd);
      return today >= ws && today <= we;
    });
    if (containingWeek) return containingWeek;
    // Fallback: first week that overlaps current month
    return monthWeeks[0] ?? null;
  }, [planData, monthWeeks]);

  // Month label
  const monthLabel = currentMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Plan period label
  const planPeriodLabel = useMemo(() => {
    if (!planData || !planData.planStartDate) return null;
    const start = new Date(planData.planStartDate + "T00:00:00").toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric", year: "numeric" },
    );
    const end = new Date(planData.planEndDate + "T00:00:00").toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric", year: "numeric" },
    );
    return tp("planPeriod", { start, end });
  }, [planData, tp]);

  // Phase click handler
  const handlePhaseClick = useCallback(
    (phase: { weekStart: string }) => {
      const d = parseISO(phase.weekStart);
      setCurrentMonth(d);
    },
    [],
  );

  // ── Clear plan ──────────────────────────────────────────
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => { if (clearTimer.current) clearTimeout(clearTimer.current); };
  }, []);

  const clearPlan = useCallback(async () => {
    if (clearing) return;
    setClearing(true);
    try {
      const res = await fetch("/api/training-plan", { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setConfirmClear(false);
      await loadPlanData();
    } catch (err) {
      console.error("Failed to clear plan:", err);
    } finally {
      setClearing(false);
    }
  }, [clearing, loadPlanData]);

  // Auto-refresh when plan data changes (created / cleared via coach chat)
  useEffect(() => {
    const handler = () => loadPlanData();
    window.addEventListener(COACH_CHAT_EVENTS.PLAN_UPDATED, handler);
    return () =>
      window.removeEventListener(COACH_CHAT_EVENTS.PLAN_UPDATED, handler);
  }, [loadPlanData]);

  // ── Render helpers ────────────────────────────────────
  if (status === "loading" || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">{tp("loading")}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-red-500">{error}</p>
          <Button variant="outline" size="sm" onClick={loadPlanData}>
            {common("retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (status !== "authenticated") return null;

  const noPlan = !planData || planData.weeks.length === 0;

  return (
    <div className="max-w-6xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-3 md:space-y-4">
      {/* ═══ Header: Plan date range + actions ═══ */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-primary/10 shrink-0">
            <CalendarDays className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold">{tp("title")}</h1>
            {planPeriodLabel && (
              <p className="text-xs text-muted-foreground truncate">{planPeriodLabel}</p>
            )}
          </div>
        </div>

        {/* Clear plan button — only shown when a plan exists */}
        {!noPlan && (
          <Button
            size="sm"
            variant={confirmClear ? "destructive" : "outline"}
            onClick={() => {
              if (confirmClear) {
                clearPlan();
              } else {
                setConfirmClear(true);
                clearTimer.current = setTimeout(() => setConfirmClear(false), 3000);
              }
            }}
            disabled={clearing}
            title={tp("resetPlanDetail")}
          >
            {clearing ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-1" />
            )}
            {confirmClear ? tp("resetPlanConfirm") : tp("resetPlan")}
          </Button>
        )}
      </header>

      {noPlan ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
          <CalendarDays className="h-12 w-12 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground mb-4">{tp("noPlan")}</p>
          <Button onClick={() => openCoachChat(true)} size="default">
            <Sparkles className="h-4 w-4 mr-2" />
            {tp("createPlan")}
          </Button>
        </div>
      ) : (
        <>
          {/* ═══ Phase Bar ═══ */}
          <PhaseBar
            phases={planData.phases}
            currentMonth={currentMonth}
            onPhaseClick={handlePhaseClick}
          />

          {/* ═══ Period Summary (toggle between current week / visible month) ═══ */}
          <PeriodSummary
            week={currentWeek}
            weeks={monthWeeks}
            monthLabel={monthLabel}
          />

          {/* ═══ Calendar ═══ */}
          <CalendarView
            weeks={planData.weeks}
            currentMonth={currentMonth}
            onMonthChange={setCurrentMonth}
          />
        </>
      )}
    </div>
  );
}
