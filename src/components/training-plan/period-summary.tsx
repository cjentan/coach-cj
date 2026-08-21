"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Route, Mountain, Clock, CalendarCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PlanWeekData } from "@/lib/training-plan-types";
import { formatDistance, formatDuration, formatElevation } from "@/lib/utils";
import { StatRow } from "./stat-row";

interface PeriodSummaryProps {
  /** The current week (the one containing today), or null if today is outside the plan. */
  week: PlanWeekData | null;
  /** Weeks overlapping the currently visible month. */
  weeks: PlanWeekData[];
  /** Human-readable label for the visible month, e.g. "March 2026". */
  monthLabel: string;
}

type Period = "week" | "month";

interface SummaryStats {
  plannedVolume: number;
  plannedElevation: number;
  plannedDuration: number;
  plannedSessions: number;
  actualVolume: number;
  actualElevation: number;
  actualDuration: number;
  completedSessions: number;
}

/** Aggregate planned vs actual stats across the given weeks. */
function computeStats(weeks: PlanWeekData[]): SummaryStats {
  const stats: SummaryStats = {
    plannedVolume: 0,
    plannedElevation: 0,
    plannedDuration: 0,
    plannedSessions: 0,
    actualVolume: 0,
    actualElevation: 0,
    actualDuration: 0,
    completedSessions: 0,
  };

  for (const week of weeks) {
    if (week.targetVolumeMeters) stats.plannedVolume += week.targetVolumeMeters;
    if (week.targetElevationMeters) stats.plannedElevation += week.targetElevationMeters;
    if (week.targetDurationSeconds) stats.plannedDuration += week.targetDurationSeconds;

    for (const day of week.days) {
      // Rest days (planned.type === "rest") are not training sessions.
      if (day.planned && day.planned.type !== "rest") stats.plannedSessions++;
      if (day.actual) {
        stats.completedSessions++;
        stats.actualVolume += day.actual.distanceMeters ?? 0;
        stats.actualElevation += day.actual.elevationGainMeters ?? 0;
        stats.actualDuration += day.actual.durationSeconds;
      }
    }
  }

  return stats;
}

/**
 * Combined summary card showing planned vs actual volume, elevation,
 * duration, and sessions for either the current week or the visible month,
 * switchable via a Week/Month toggle.
 */
export function PeriodSummary({ week, weeks, monthLabel }: PeriodSummaryProps) {
  const t = useTranslations("training-plan");
  const [period, setPeriod] = useState<Period>("week");

  const weekStats = useMemo(() => computeStats(week ? [week] : []), [week]);
  const monthStats = useMemo(() => computeStats(weeks), [weeks]);

  const stats = period === "week" ? weekStats : monthStats;

  // Format week label like "Mon 10 Aug to Sun 16 Aug" (composed manually so the
  // day comes before the month, which en-US toLocaleDateString would reorder).
  const weekLabel = useMemo(() => {
    if (!week || week.days.length < 2) return "";
    const start = new Date(week.days[0].date + "T00:00:00");
    const end = new Date(week.days[week.days.length - 1].date + "T00:00:00");
    const fmt = (d: Date) =>
      [
        d.toLocaleDateString("en-US", { weekday: "short" }),
        d.toLocaleDateString("en-US", { day: "numeric" }),
        d.toLocaleDateString("en-US", { month: "short" }),
      ].join(" ");
    return `${fmt(start)} to ${fmt(end)}`;
  }, [week]);

  // Render nothing when neither period has data (mirrors the previous cards).
  if (!week && weeks.length === 0) return null;

  const periodLabel = period === "week" ? weekLabel : monthLabel;

  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-0 truncate">
            {periodLabel}
          </h3>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList className="h-8">
              <TabsTrigger value="week" className="text-xs px-3">
                {t("week")}
              </TabsTrigger>
              <TabsTrigger value="month" className="text-xs px-3">
                {t("month")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatRow
            icon={<Route className="h-3 w-3" />}
            label={t("volume")}
            planned={stats.plannedVolume > 0 ? formatDistance(stats.plannedVolume) : "—"}
            actual={stats.actualVolume > 0 ? formatDistance(stats.actualVolume) : "—"}
            fraction={stats.plannedVolume > 0 ? stats.actualVolume / stats.plannedVolume : 0}
          />
          <StatRow
            icon={<Mountain className="h-3 w-3" />}
            label={t("elevation")}
            planned={stats.plannedElevation > 0 ? formatElevation(stats.plannedElevation) : "—"}
            actual={stats.actualElevation > 0 ? formatElevation(stats.actualElevation) : "—"}
            fraction={
              stats.plannedElevation > 0 ? stats.actualElevation / stats.plannedElevation : 0
            }
          />
          <StatRow
            icon={<Clock className="h-3 w-3" />}
            label={t("duration")}
            planned={stats.plannedDuration > 0 ? formatDuration(stats.plannedDuration) : "—"}
            actual={stats.actualDuration > 0 ? formatDuration(stats.actualDuration) : "—"}
            fraction={stats.plannedDuration > 0 ? stats.actualDuration / stats.plannedDuration : 0}
          />
          <StatRow
            icon={<CalendarCheck className="h-3 w-3" />}
            label={t("sessions")}
            planned={String(stats.plannedSessions)}
            actual={String(stats.completedSessions)}
            fraction={
              stats.plannedSessions > 0 ? stats.completedSessions / stats.plannedSessions : 0
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
