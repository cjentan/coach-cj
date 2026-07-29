"use client";

import { useMemo } from "react";
import { Route, Mountain, Clock, CalendarCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { PlanWeekData } from "@/lib/training-plan-types";
import { formatDistance, formatDuration, formatElevation } from "@/lib/utils";

interface WeeklySummaryProps {
  week: PlanWeekData;
}

/**
 * Summary card for a single week showing planned vs actual
 * volume, elevation, duration, and sessions with progress bars.
 */
export function WeeklySummary({ week }: WeeklySummaryProps) {
  const stats = useMemo(() => {
    let actualVolume = 0;
    let actualElevation = 0;
    let actualDuration = 0;
    let completedSessions = 0;
    let plannedSessions = 0;

    for (const day of week.days) {
      if (day.planned) plannedSessions++;
      if (day.actual) {
        completedSessions++;
        actualVolume += day.actual.distanceMeters ?? 0;
        actualElevation += day.actual.elevationGainMeters ?? 0;
        actualDuration += day.actual.durationSeconds;
      }
    }

    return {
      plannedVolume: week.targetVolumeMeters ?? 0,
      plannedElevation: week.targetElevationMeters ?? 0,
      plannedDuration: week.targetDurationSeconds ?? 0,
      plannedSessions,
      actualVolume,
      actualElevation,
      actualDuration,
      completedSessions,
    };
  }, [week]);

  // Format week label like "Mon 3/10 — Sun 3/16"
  const weekLabel = useMemo(() => {
    if (!week.days.length) return "";
    const start = new Date(week.days[0].date + "T00:00:00");
    const end = new Date(week.days[6].date + "T00:00:00");
    const fmt = (d: Date) =>
      d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
    return `${fmt(start)} — ${fmt(end)}`;
  }, [week]);

  return (
    <Card>
      <CardContent className="py-3 px-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          {weekLabel}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <WeekStatRow
            icon={<Route className="h-3 w-3" />}
            label="Volume"
            planned={stats.plannedVolume > 0 ? formatDistance(stats.plannedVolume) : "—"}
            actual={stats.actualVolume > 0 ? formatDistance(stats.actualVolume) : "—"}
            fraction={stats.plannedVolume > 0 ? stats.actualVolume / stats.plannedVolume : 0}
          />
          <WeekStatRow
            icon={<Mountain className="h-3 w-3" />}
            label="Elevation"
            planned={stats.plannedElevation > 0 ? formatElevation(stats.plannedElevation) : "—"}
            actual={stats.actualElevation > 0 ? formatElevation(stats.actualElevation) : "—"}
            fraction={stats.plannedElevation > 0 ? stats.actualElevation / stats.plannedElevation : 0}
          />
          <WeekStatRow
            icon={<Clock className="h-3 w-3" />}
            label="Duration"
            planned={stats.plannedDuration > 0 ? formatDuration(stats.plannedDuration) : "—"}
            actual={stats.actualDuration > 0 ? formatDuration(stats.actualDuration) : "—"}
            fraction={stats.plannedDuration > 0 ? stats.actualDuration / stats.plannedDuration : 0}
          />
          <WeekStatRow
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

// ── Internal ────────────────────────────────────────────

function WeekStatRow({
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
