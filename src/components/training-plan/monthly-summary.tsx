"use client";

import { useMemo } from "react";
import { Route, Mountain, Clock, CalendarCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { PlanWeekData } from "@/lib/training-plan-types";
import { formatDistance, formatDuration, formatElevation } from "@/lib/utils";
import { StatRow } from "./stat-row";

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
          <StatRow
            icon={<Route className="h-3 w-3" />}
            label="Volume"
            planned={stats.plannedVolume > 0 ? formatDistance(stats.plannedVolume) : "—"}
            actual={stats.actualVolume > 0 ? formatDistance(stats.actualVolume) : "—"}
            fraction={stats.plannedVolume > 0 ? stats.actualVolume / stats.plannedVolume : 0}
          />
          <StatRow
            icon={<Mountain className="h-3 w-3" />}
            label="Elevation"
            planned={stats.plannedElevation > 0 ? formatElevation(stats.plannedElevation) : "—"}
            actual={stats.actualElevation > 0 ? formatElevation(stats.actualElevation) : "—"}
            fraction={stats.plannedElevation > 0 ? stats.actualElevation / stats.plannedElevation : 0}
          />
          <StatRow
            icon={<Clock className="h-3 w-3" />}
            label="Duration"
            planned={stats.plannedDuration > 0 ? formatDuration(stats.plannedDuration) : "—"}
            actual={stats.actualDuration > 0 ? formatDuration(stats.actualDuration) : "—"}
            fraction={stats.plannedDuration > 0 ? stats.actualDuration / stats.plannedDuration : 0}
          />
          <StatRow
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

