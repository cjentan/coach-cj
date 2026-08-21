"use client";

import { useState, useMemo, useCallback, memo } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Mountain,
  Moon,
  Clock,
  Route,
  ExternalLink,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  isSameDay,
  parseISO,
  format,
} from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn, formatDistance, formatDuration, formatElevation, inferEffort } from "@/lib/utils";
import type { PlanWeekData, PlanDay } from "@/lib/training-plan-types";
import { EFFORT_STYLES, getIcon } from "./calendar-utils";
import { WeekListView } from "./calendar-week-list";

interface CalendarViewProps {
  weeks: PlanWeekData[];
  currentMonth: Date;
  onMonthChange: (date: Date) => void;
}

// ── Main CalendarView ───────────────────────────────────

export function CalendarView({ weeks, currentMonth, onMonthChange }: CalendarViewProps) {
  const t = useTranslations("training-plan");
  const labelsT = useTranslations("labels");
  const router = useRouter();

  // Build a lookup map: dateString → PlanDay
  const dayMap = useMemo(() => {
    const map = new Map<string, PlanDay>();
    for (const week of weeks) {
      for (const day of week.days) {
        map.set(day.date, day);
      }
    }
    return map;
  }, [weeks]);

  // Compute the grid of dates to render
  const gridDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 }); // Monday
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentMonth]);

  const today = useMemo(() => new Date(), []);

  // ── Dialog state ──────────────────────────────────────
  const [selectedDay, setSelectedDay] = useState<PlanDay | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleDayClick = useCallback((planDay: PlanDay | null) => {
    if (!planDay) return;
    setSelectedDay(planDay);
    setDialogOpen(true);
  }, []);

  // ── Week list state (mobile only) ─────────────────────
  // Find the index of the week containing today, or first week
  const defaultWeekIndex = useMemo(() => {
    const todayStr = format(today, "yyyy-MM-dd");
    const idx = weeks.findIndex((w) => w.days.some((d) => d.date === todayStr));
    return idx >= 0 ? idx : 0;
  }, [weeks, today]);

  const [weekIndex, setWeekIndex] = useState(defaultWeekIndex);

  const currentWeek = weeks[weekIndex];

  // Week navigation — sync month state so phase bar / summaries update
  const goPrevWeek = useCallback(() => {
    if (weekIndex <= 0) return;
    const newIdx = weekIndex - 1;
    setWeekIndex(newIdx);
    // Sync month to the new week's start
    const ws = parseISO(weeks[newIdx].weekStart);
    if (
      ws.getMonth() !== currentMonth.getMonth() ||
      ws.getFullYear() !== currentMonth.getFullYear()
    ) {
      onMonthChange(ws);
    }
  }, [weekIndex, weeks, currentMonth, onMonthChange]);

  const goNextWeek = useCallback(() => {
    if (weekIndex >= weeks.length - 1) return;
    const newIdx = weekIndex + 1;
    setWeekIndex(newIdx);
    const ws = parseISO(weeks[newIdx].weekStart);
    if (
      ws.getMonth() !== currentMonth.getMonth() ||
      ws.getFullYear() !== currentMonth.getFullYear()
    ) {
      onMonthChange(ws);
    }
  }, [weekIndex, weeks, currentMonth, onMonthChange]);

  const prevMonth = () => onMonthChange(subMonths(currentMonth, 1));
  const nextMonth = () => onMonthChange(addMonths(currentMonth, 1));
  const goToday = () => onMonthChange(new Date());

  // Count how many rows so we can set a min-height
  const numWeeks = Math.ceil(gridDays.length / 7);

  return (
    <>
      {/* ── Desktop: Month grid ── */}
      <div className="hidden sm:block bg-card border rounded-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-b">
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={prevMonth}
              className="p-1 rounded hover:bg-muted transition-colors"
              aria-label={t("previousMonth")}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="font-semibold text-xs sm:text-sm">
              {format(currentMonth, "MMMM yyyy")}
            </h2>
            <button
              onClick={nextMonth}
              className="p-1 rounded hover:bg-muted transition-colors"
              aria-label={t("nextMonth")}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={goToday}
            className="text-[0.6875rem] sm:text-xs font-medium text-primary hover:underline"
          >
            {t("today")}
          </button>
        </div>

        {/* Day-of-week header */}
        <div className="grid grid-cols-7 border-b">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div
              key={d}
              className="px-1 sm:px-2 py-1 sm:py-1.5 text-[0.5625rem] sm:text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground text-center"
            >
              {labelsT("days.short." + d)}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7" style={{ minHeight: `${numWeeks * 5.625}rem` }}>
          {gridDays.map((day) => {
            const dateStr = format(day, "yyyy-MM-dd");
            const planDay = dayMap.get(dateStr);
            const inMonth = day.getMonth() === currentMonth.getMonth();
            const isTodayDate = isSameDay(day, today);

            return (
              <DayCell
                key={dateStr}
                day={day}
                planDay={planDay ?? null}
                inMonth={inMonth}
                isToday={isTodayDate}
                onClick={handleDayClick}
              />
            );
          })}
        </div>
      </div>

      {/* ── Mobile: Week list ── */}
      <div className="block sm:hidden bg-card border rounded-lg overflow-hidden">
        {currentWeek ? (
          <WeekListView
            week={currentWeek}
            weekIndex={weekIndex}
            totalWeeks={weeks.length}
            onPrevWeek={goPrevWeek}
            onNextWeek={goNextWeek}
            onDayClick={handleDayClick}
          />
        ) : (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            {t("noPlanData")}
          </div>
        )}
      </div>

      {/* ═══ Day Detail Dialog (shared) ═══ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          {selectedDay && (
            <DayDetailContent
              planDay={selectedDay}
              router={router}
              onClose={() => setDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── DayCell (desktop grid) ──────────────────────────────

const DayCell = memo(function DayCell({
  day,
  planDay,
  inMonth,
  isToday,
  onClick,
}: {
  day: Date;
  planDay: PlanDay | null;
  inMonth: boolean;
  isToday: boolean;
  onClick: (planDay: PlanDay | null) => void;
}) {
  const t = useTranslations("training-plan");
  const dayNumber = day.getDate();
  const planned = planDay?.planned;

  // Determine if this day is fully in the past
  const now = new Date();
  const isPast = day < new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Classify the planned session
  const effort = planned ? inferEffort(planned.type, planned.description) : "rest";
  const effortStyle = EFFORT_STYLES[effort];

  // Activity icon
  const IconComponent = planned ? getIcon(planned.type) : null;

  const hasElevation = (planned?.targetElevation ?? 0) > 0;
  const hasActual = !!planDay?.actual;

  const isClickable = !!planned || hasActual;

  return (
    <button
      type="button"
      onClick={() => onClick(isClickable ? planDay : null)}
      className={cn(
        "border-b border-r p-1 sm:p-1.5 text-xs transition-colors relative text-left w-full",
        "min-h-[3.75rem] sm:min-h-[4.5rem] md:min-h-[5.5rem] lg:min-h-[6.25rem]",
        "border-l-[3px]",
        effortStyle.border,
        !inMonth && "opacity-30",
        isPast && !planDay?.actual && !planDay?.planned && "opacity-40",
        isToday && "bg-primary/5 ring-1 ring-primary/20 ring-inset ring-l-0",
        inMonth && !isToday && "hover:bg-muted/30",
        isClickable && "cursor-pointer",
        !isClickable && "cursor-default"
      )}
    >
      {/* ── Top row: Date + icon + effort badge ── */}
      <div className="flex items-center gap-1 sm:gap-1.5 mb-0.5">
        <span
          className={cn(
            "inline-flex items-center justify-center w-5 h-5 text-[0.625rem] sm:text-[0.6875rem] font-medium rounded-full shrink-0",
            isToday && "bg-primary text-primary-foreground",
            !isToday && "text-muted-foreground"
          )}
        >
          {dayNumber}
        </span>

        {planned && planned.type !== "rest" && IconComponent && (
          <IconComponent className="h-3 w-3 shrink-0 text-muted-foreground hidden sm:inline" />
        )}

        {planned && (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-1.5 py-0 text-[0.5rem] sm:text-[0.5625rem] font-medium leading-tight truncate max-w-full",
              effortStyle.badge
            )}
          >
            {planned.type === "rest" ? t("rest") : planned.type}
          </span>
        )}
      </div>

      {/* ── Distance + Elevation row ── */}
      {planned && planned.type !== "rest" && (
        <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
          {planned.targetDistance && planned.targetDistance > 0 && (
            <span className="text-[0.5625rem] sm:text-[0.625rem] font-medium truncate">
              {formatDistance(planned.targetDistance)}
            </span>
          )}

          {hasElevation && (
            <span className="text-[0.5rem] sm:text-[0.5625rem] text-muted-foreground flex items-center gap-0.5 truncate">
              <Mountain className="h-2.5 w-2.5 shrink-0 hidden sm:inline" />
              {formatElevation(planned!.targetElevation)}
            </span>
          )}
        </div>
      )}

      {/* ── Actual activity overlay ── */}
      {hasActual && planDay?.actual && (
        <div className="mt-0.5 flex items-center gap-1 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
          <span className="text-[0.5rem] sm:text-[0.5625rem] font-medium truncate">
            {planDay.actual.name}
          </span>
          {planDay.actual.distanceMeters != null && planDay.actual.distanceMeters > 0 && (
            <span className="text-[0.5rem] text-muted-foreground shrink-0 hidden sm:inline">
              {formatDistance(planDay.actual.distanceMeters)}
            </span>
          )}
        </div>
      )}

      {/* ── Empty past day ── */}
      {isPast && !planned && !hasActual && (
        <p className="text-[0.5rem] sm:text-[0.5625rem] text-muted-foreground italic mt-0.5">—</p>
      )}
    </button>
  );
});

// ── Day Detail Dialog Content (shared) ──────────────────

function DayDetailContent({
  planDay,
  router,
  onClose,
}: {
  planDay: PlanDay;
  router: ReturnType<typeof useRouter>;
  onClose: () => void;
}) {
  const { planned, actual, date, isPast } = planDay;
  const t = useTranslations("training-plan");

  // Format the date nicely — derives day-of-week from the date string
  // directly, so the title and subtitle always agree regardless of server
  // timezone vs client timezone.
  const formattedDate = useMemo(() => {
    const d = new Date(date + "T00:00:00");
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }, [date]);

  const dayAbbr = useMemo(() => {
    const d = new Date(date + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short" });
  }, [date]);

  // Classify effort
  const effort = planned ? inferEffort(planned.type, planned.description) : null;
  const effortStyle = effort ? EFFORT_STYLES[effort] : null;

  // Activity icon
  const IconComponent = planned ? getIcon(planned.type) : null;

  const handleViewActivity = () => {
    if (!actual?.activityId) return;
    onClose();
    router.push(`/activities/${actual.activityId}`);
  };

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          {planned && IconComponent && (
            <div className={cn("p-2 rounded-lg", effortStyle?.badge ?? "bg-muted/30")}>
              <IconComponent className="h-5 w-5" />
            </div>
          )}
          <div>
            <DialogTitle className="text-base">{formattedDate}</DialogTitle>
            <p className="text-xs text-muted-foreground">{dayAbbr}</p>
          </div>
        </div>
      </DialogHeader>

      <div className="space-y-4 pt-2">
        {/* ── Planned Workout Section ── */}
        {planned ? (
          <div className="space-y-3">
            {/* Type + Effort badge */}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                  effortStyle?.badge ?? "bg-muted/30 text-muted-foreground"
                )}
              >
                {planned.type === "rest" ? t("rest") : planned.type}
              </span>
              {effort && effort !== "rest" && (
                <span
                  className={cn(
                    "text-xs font-medium",
                    effortStyle?.text ?? "text-muted-foreground"
                  )}
                >
                  {effortStyle?.label ? `${t(effortStyle.label)} ${t("effort")}` : ""}
                </span>
              )}
            </div>

            {/* Metrics grid */}
            <div className="grid grid-cols-3 gap-3">
              {planned.targetDistance != null && planned.targetDistance > 0 && (
                <div className="flex flex-col items-center p-2 rounded-lg bg-muted/20">
                  <Route className="h-4 w-4 text-muted-foreground mb-1" />
                  <span className="text-sm font-semibold">
                    {formatDistance(planned.targetDistance)}
                  </span>
                  <span className="text-[0.625rem] text-muted-foreground">{t("distance")}</span>
                </div>
              )}
              {(planned.targetElevation ?? 0) > 0 && (
                <div className="flex flex-col items-center p-2 rounded-lg bg-muted/20">
                  <Mountain className="h-4 w-4 text-muted-foreground mb-1" />
                  <span className="text-sm font-semibold">
                    {formatElevation(planned.targetElevation)}
                  </span>
                  <span className="text-[0.625rem] text-muted-foreground">{t("elevation")}</span>
                </div>
              )}
              {planned.targetDuration != null && planned.targetDuration > 0 && (
                <div className="flex flex-col items-center p-2 rounded-lg bg-muted/20">
                  <Clock className="h-4 w-4 text-muted-foreground mb-1" />
                  <span className="text-sm font-semibold">
                    {formatDuration(planned.targetDuration)}
                  </span>
                  <span className="text-[0.625rem] text-muted-foreground">{t("duration")}</span>
                </div>
              )}
            </div>

            {/* Description */}
            {planned.description && (
              <div className="rounded-lg border bg-muted/10 p-3">
                <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">
                  {planned.description}
                </p>
              </div>
            )}

            {/* Change reason — strips internal "Created: " / "Updated: " prefix
                that the AI coach uses in adjustmentHistory, since the amber
                styling + icon already signals it's a modification. */}
            {planned.changeReason && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-2.5">
                <p className="text-[0.6875rem] text-amber-700 dark:text-amber-400">
                  {planned.changeReason.replace(/^(Created|Updated):\s*/i, "")}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-4 text-muted-foreground">
            <Moon className="h-6 w-6" />
            <p className="text-sm">{t("restDay")}</p>
          </div>
        )}

        {/* ── Actual Activity Section ── */}
        {actual && (
          <div className="space-y-3 pt-2 border-t">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {t("completedActivity")}
            </h4>

            {/* Actual metrics */}
            <div className="grid grid-cols-3 gap-3">
              {actual.distanceMeters != null && actual.distanceMeters > 0 && (
                <div className="flex flex-col items-center p-2 rounded-lg bg-green-500/5">
                  <Route className="h-4 w-4 text-green-600 mb-1" />
                  <span className="text-sm font-semibold">
                    {formatDistance(actual.distanceMeters)}
                  </span>
                  <span className="text-[0.625rem] text-muted-foreground">{t("distance")}</span>
                </div>
              )}
              {actual.elevationGainMeters != null && actual.elevationGainMeters > 0 && (
                <div className="flex flex-col items-center p-2 rounded-lg bg-green-500/5">
                  <Mountain className="h-4 w-4 text-green-600 mb-1" />
                  <span className="text-sm font-semibold">
                    {formatElevation(actual.elevationGainMeters)}
                  </span>
                  <span className="text-[0.625rem] text-muted-foreground">Elevation</span>
                </div>
              )}
              {actual.durationSeconds > 0 && (
                <div className="flex flex-col items-center p-2 rounded-lg bg-green-500/5">
                  <Clock className="h-4 w-4 text-green-600 mb-1" />
                  <span className="text-sm font-semibold">
                    {formatDuration(actual.durationSeconds)}
                  </span>
                  <span className="text-[0.625rem] text-muted-foreground">{t("duration")}</span>
                </div>
              )}
            </div>

            {/* Activity name + source */}
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{actual.name}</span>
              <span className="text-[0.625rem] text-muted-foreground uppercase">
                {t("via")} {actual.source}
              </span>
            </div>

            {/* View Activity button (past days only) */}
            {isPast && actual.activityId && (
              <Button variant="default" className="w-full gap-2" onClick={handleViewActivity}>
                <ExternalLink className="h-4 w-4" />
                {t("viewActivityDetails")}
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
