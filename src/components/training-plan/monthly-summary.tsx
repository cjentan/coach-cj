"use client";

import { useMemo } from "react";
import { Route, Mountain, Clock, CalendarCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { PlanWeekData } from "@/lib/training-plan-types";
import { formatDistance, formatDuration, formatElevation } from "@/lib/utils";

interface MonthlySummaryProps {
  weeks: PlanWeekData[];
  monthLabel: string;
}

/**
 * Compact monthly summary card showing planned vs actual aggregates
 * for volume, elevation, duration, and sessions across all weeks
 * in the month.
 */
export function MonthlySummary({ weeks, monthLabel }: MonthlySummaryProps) {
  const stats = useMemo(() => {
    let plannedVolume = 0;
    let plannedElevation = 0;
    let plannedDuration = 0;
    let plannedSessions = 0;
    let actualVolume = 0;
    let actualElevation = 0;
    let actualDuration = 0;
    let completedSessions = 0;

    for (const week of weeks) {
      if (week.targetVolumeMeters) plannedVolume += week.targetVolumeMeters;
      if (week.targetElevationMeters) plannedElevation += week.targetElevationMeters;
      if (week.targetDurationSeconds) plannedDuration += week.targetDurationSeconds;

      for (const day of week.days) {
        if (day.planned) plannedSessions++;
        if (day.actual) {
          completedSessions++;
          actualVolume += day.actual.distanceMeters ?? 0;
          actualElevation += day.actual.elevationGainMeters ?? 0;
          actualDuration += day.actual.durationSeconds;
        }
      }
    }

    return {
      plannedVolume,
      plannedElevation,
      plannedDuration,
      plannedSessions,
      actualVolume,
      actualElevation,
      actualDuration,
      completedSessions,
    };
  }, [weeks]);

  if (weeks.length === 0) return null;

  return (
    <Card>
      <CardContent className="py-3 px-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          {monthLabel}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatItem
            icon={<Route className="h-3 w-3" />}
            label="Volume"
            planned={stats.plannedVolume > 0 ? formatDistance(stats.plannedVolume) : "—"}
            actual={stats.actualVolume > 0 ? formatDistance(stats.actualVolume) : "—"}
            fraction={stats.plannedVolume > 0 ? stats.actualVolume / stats.plannedVolume : 0}
          />
          <StatItem
            icon={<Mountain className="h-3 w-3" />}
            label="Elevation"
            planned={stats.plannedElevation > 0 ? formatElevation(stats.plannedElevation) : "—"}
            actual={stats.actualElevation > 0 ? formatElevation(stats.actualElevation) : "—"}
            fraction={stats.plannedElevation > 0 ? stats.actualElevation / stats.plannedElevation : 0}
          />
          <StatItem
            icon={<Clock className="h-3 w-3" />}
            label="Duration"
            planned={stats.plannedDuration > 0 ? formatDuration(stats.plannedDuration) : "—"}
            actual={stats.actualDuration > 0 ? formatDuration(stats.actualDuration) : "—"}
            fraction={stats.plannedDuration > 0 ? stats.actualDuration / stats.plannedDuration : 0}
          />
          <StatItem
            icon={<CalendarCheck className="h-3 w-3" />}
            label="Sessions"
            planned={String(stats.plannedSessions)}
            actual={String(stats.completedSessions)}
            fraction={stats.plannedSessions > 0 ? stats.completedSessions / stats.plannedSessions : 0}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Internal stat row ───────────────────────────────────

function StatItem({
  icon,
  label,
  planned,
  actual,
  fraction,
}: {
  icon: React.ReactNode;
  label: string;
  planned: string;
  actual: string;
  fraction: number;
}) {
  const pct = Math.min(Math.round(fraction * 100), 100);
  const barColor =
    pct >= 90 ? "bg-green-500" : pct >= 70 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="min-w-0">
      <p className="text-[0.625rem] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
        {icon}
        {label}
      </p>
      <div className="flex items-baseline gap-1.5 text-xs">
        <span className="text-muted-foreground">P:</span>
        <span className="font-medium">{planned}</span>
      </div>
      <div className="flex items-baseline gap-1.5 text-xs mb-1.5">
        <span className="text-muted-foreground">A:</span>
        <span className="font-medium">{actual}</span>
      </div>
      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[0.625rem] text-muted-foreground mt-0.5">{pct}%</p>
    </div>
  );
}
