"use client";

/**
 * Mobile week-list views for the training-plan calendar.
 *
 * `WeekListView` renders a single week as a scrolling list of `DayCard`s,
 * with prev/next week navigation. Both are pulled out of `calendar-view.tsx`
 * so the desktop grid and the mobile list stay in separate, focused modules.
 */
import { ChevronLeft, ChevronRight, Mountain, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn, formatDistance, formatDuration, formatElevation, inferEffort } from "@/lib/utils";
import type { PlanWeekData, PlanDay } from "@/lib/training-plan-types";
import { EFFORT_STYLES, getIcon, formatWeekRange } from "./calendar-utils";

// ── WeekListView (mobile) ───────────────────────────────

export function WeekListView({
  week,
  weekIndex,
  totalWeeks,
  onPrevWeek,
  onNextWeek,
  onDayClick,
}: {
  week: PlanWeekData;
  weekIndex: number;
  totalWeeks: number;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onDayClick: (planDay: PlanDay | null) => void;
}) {
  const t = useTranslations("training-plan");
  const weekLabel = formatWeekRange(week.weekStart, week.weekEnd);

  return (
    <div className="divide-y">
      {/* Week navigation header */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-muted/10">
        <button
          onClick={onPrevWeek}
          disabled={weekIndex <= 0}
          className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label={t("previousWeek")}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("weekOf")}
          </p>
          <p className="text-sm font-medium">{weekLabel}</p>
        </div>
        <button
          onClick={onNextWeek}
          disabled={weekIndex >= totalWeeks - 1}
          className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label={t("nextWeek")}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Day cards */}
      <div className="divide-y">
        {week.days.map((day) => (
          <DayCard key={day.date} planDay={day} onClick={onDayClick} />
        ))}
      </div>
    </div>
  );
}

// ── DayCard (mobile week list) ──────────────────────────

function DayCard({
  planDay,
  onClick,
}: {
  planDay: PlanDay;
  onClick: (planDay: PlanDay | null) => void;
}) {
  const { planned, actual, date, dayLabel, isPast, isToday } = planDay;
  const t = useTranslations("training-plan");
  const now = new Date();
  const dayDate = new Date(date + "T00:00:00");
  const isPastDay = dayDate < new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Classify effort
  const effort = planned ? inferEffort(planned.type, planned.description) : "rest";
  const effortStyle = EFFORT_STYLES[effort];

  // Activity icon
  const IconComponent = planned ? getIcon(planned.type) : null;

  const hasElevation = (planned?.targetElevation ?? 0) > 0;
  const hasActual = !!actual;
  const isClickable = !!planned || hasActual;

  // Format the day-number display (e.g. "Mon 10")
  const dayNumber = dayDate.getDate();
  const dayNameAbbr = dayLabel.slice(0, 3);
  const dayHeader = `${dayNameAbbr} ${dayNumber}`;

  return (
    <button
      type="button"
      disabled={!isClickable}
      onClick={() => onClick(isClickable ? planDay : null)}
      className={cn(
        "w-full text-left transition-colors relative",
        "border-l-[3px]",
        effortStyle.border,
        isPastDay && !planned && !hasActual && "opacity-40",
        isToday && "bg-primary/5",
        isClickable && "cursor-pointer",
        !isClickable && "cursor-default",
        "hover:bg-muted/20"
      )}
    >
      <div className="px-3 py-2.5 space-y-1.5">
        {/* ── Row 1: Day header + activity badge ── */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-xs font-semibold shrink-0 w-14",
              isToday && "text-primary",
              !isToday && "text-foreground"
            )}
          >
            {dayHeader}
          </span>

          {planned ? (
            <>
              {IconComponent && planned.type !== "rest" && (
                <IconComponent className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[0.625rem] font-medium leading-tight truncate max-w-[40%]",
                  effortStyle.badge
                )}
              >
                {planned.type === "rest" ? t("rest") : planned.type}
              </span>
            </>
          ) : (
            <span className="text-[0.625rem] text-muted-foreground italic">
              {isPastDay ? t("noPlanShort") : "—"}
            </span>
          )}
        </div>

        {/* ── Row 2: Distance + Elevation ── */}
        {planned && planned.type !== "rest" && (
          <div className="flex items-center gap-3 pl-14">
            {planned.targetDistance != null && planned.targetDistance > 0 && (
              <span className="text-xs font-medium text-foreground">
                {formatDistance(planned.targetDistance)}
              </span>
            )}
            {hasElevation && (
              <span className="text-[0.6875rem] text-muted-foreground flex items-center gap-1">
                <Mountain className="h-3 w-3" />
                {formatElevation(planned.targetElevation)}
              </span>
            )}
            {planned.targetDuration != null && planned.targetDuration > 0 && (
              <span className="text-[0.6875rem] text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDuration(planned.targetDuration)}
              </span>
            )}
          </div>
        )}

        {/* ── Row 3: Description (first line) ── */}
        {planned?.description && planned.type !== "rest" && (
          <p className="text-[0.6875rem] text-muted-foreground/70 pl-14 line-clamp-1 leading-relaxed">
            {planned.description}
          </p>
        )}

        {/* ── Row 4: Actual activity ── */}
        {hasActual && actual && (
          <div className="flex items-center gap-2 pl-14">
            <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
            <span className="text-xs font-medium truncate">{actual.name}</span>
            {actual.distanceMeters != null && actual.distanceMeters > 0 && (
              <span className="text-[0.625rem] text-muted-foreground shrink-0">
                {formatDistance(actual.distanceMeters)}
              </span>
            )}
            <span className="text-[0.5625rem] text-muted-foreground uppercase shrink-0">
              {t("via")} {actual.source}
            </span>
          </div>
        )}

        {/* ── Change indicator ── */}
        {planned?.changeReason && (
          <div className="flex items-center gap-1.5 pl-14">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            <span className="text-[0.625rem] text-amber-600 dark:text-amber-400 truncate">
              {planned.changeReason.replace(/^(Created|Updated):\s*/i, "")}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}
