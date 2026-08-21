"use client";

/**
 * Shared presentational helpers for the training-plan calendar.
 *
 * These pure helpers and style maps are used by `calendar-view.tsx`, the
 * desktop grid, and `calendar-week-list.tsx`, the mobile week list. Keeping
 * them here avoids duplicating them across the two entry components.
 */
import { Footprints, Bike, Waves, Dumbbell, Mountain, Moon, Activity } from "lucide-react";
import { parseISO } from "date-fns";
import type { ComponentType } from "react";
import type { EffortLevel } from "@/lib/utils";

// ── Effort styling map ──────────────────────────────────

export const EFFORT_STYLES: Record<
  EffortLevel,
  { border: string; badge: string; text: string; label: string }
> = {
  rest: {
    border: "border-l-muted",
    badge: "bg-muted/30 text-muted-foreground",
    text: "text-muted-foreground",
    label: "rest",
  },
  easy: {
    border: "border-l-green-500",
    badge: "bg-green-500/15 text-green-700 dark:text-green-400",
    text: "text-green-700 dark:text-green-400",
    label: "effortEasy",
  },
  moderate: {
    border: "border-l-amber-500",
    badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    text: "text-amber-700 dark:text-amber-400",
    label: "effortModerate",
  },
  hard: {
    border: "border-l-red-500",
    badge: "bg-red-500/15 text-red-700 dark:text-red-400",
    text: "text-red-700 dark:text-red-400",
    label: "effortHard",
  },
};

// ── Activity icon map ───────────────────────────────────

const ACTIVITY_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  run: Footprints,
  ride: Bike,
  swim: Waves,
  workout: Dumbbell,
  hike: Mountain,
  rest: Moon,
  other: Activity,
};

export function getIcon(type: string): ComponentType<{ className?: string }> {
  return ACTIVITY_ICONS[type.toLowerCase()] ?? Activity;
}

/**
 * Format a week date range label e.g. "Mar 10 — Mar 16"
 */
export function formatWeekRange(startIso: string, endIso: string): string {
  const s = parseISO(startIso);
  const e = parseISO(endIso);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(s)} — ${fmt(e)}`;
}
