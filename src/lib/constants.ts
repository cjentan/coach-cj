import { Activity, Bike, Waves, Mountain, Footprints, Dumbbell } from "lucide-react";
import type { ComponentType } from "react";

/**
 * Shared constants for the coach application.
 *
 * Import from this file instead of defining inline to keep values
 * consistent across the codebase.
 */

// ── Phase colors ──────────────────────────────────────────────────────

export const PHASE_COLORS: Record<string, string> = {
  Base: "#3b82f6",
  Build: "#f59e0b",
  Peak: "#ef4444",
  Taper: "#22c55e",
  Race: "#a855f7",
  Recovery: "#06b6d4",
  Rebuild: "#06b6d4",
};

// ── Activity types (for selectors) ────────────────────────────────────
//
// `labelKey` values map to `labels.activityTypes.<labelKey>` in the
// message files. Render with `t("labels.activityTypes." + option.labelKey)`.

export interface ActivityTypeOption {
  value: string;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
}

export const ACTIVITY_TYPES: ActivityTypeOption[] = [
  { value: "run", labelKey: "run", icon: Activity },
  { value: "ride", labelKey: "ride", icon: Bike },
  { value: "swim", labelKey: "swim", icon: Waves },
  { value: "hike", labelKey: "hike", icon: Mountain },
  { value: "walk", labelKey: "walk", icon: Footprints },
  { value: "workout", labelKey: "workout", icon: Dumbbell },
  { value: "other", labelKey: "other", icon: Activity },
];

// ── Sub-type options ──────────────────────────────────────────────────
//
// `labelKey` values map to `labels.subTypes.<labelKey>` in the message files.

export const SUB_TYPE_OPTIONS: Record<string, { value: string; labelKey: string }[]> = {
  run: [
    { value: "trail_running", labelKey: "trail_running" },
    { value: "treadmill", labelKey: "treadmill" },
    { value: "virtual_run", labelKey: "virtual_run" },
  ],
  ride: [
    { value: "mountain_biking", labelKey: "mountain_biking" },
    { value: "gravel_cycling", labelKey: "gravel_cycling" },
    { value: "road_cycling", labelKey: "road_cycling" },
    { value: "indoor_cycling", labelKey: "indoor_cycling" },
    { value: "virtual_ride", labelKey: "virtual_ride" },
    { value: "handcycle", labelKey: "handcycle" },
  ],
  swim: [
    { value: "open_water", labelKey: "open_water" },
    { value: "lap_swimming", labelKey: "lap_swimming" },
  ],
  workout: [
    { value: "strength_training", labelKey: "strength_training" },
    { value: "crossfit", labelKey: "crossfit" },
    { value: "yoga", labelKey: "yoga" },
    { value: "elliptical", labelKey: "elliptical" },
    { value: "stair_stepper", labelKey: "stair_stepper" },
    { value: "pilates", labelKey: "pilates" },
  ],
  other: [
    { value: "rock_climbing", labelKey: "rock_climbing" },
    { value: "surfing", labelKey: "surfing" },
    { value: "stand_up_paddling", labelKey: "stand_up_paddling" },
    { value: "kayaking", labelKey: "kayaking" },
    { value: "canoeing", labelKey: "canoeing" },
    { value: "rowing", labelKey: "rowing" },
    { value: "ice_skating", labelKey: "ice_skating" },
    { value: "inline_skating", labelKey: "inline_skating" },
    { value: "nordic_skiing", labelKey: "nordic_skiing" },
    { value: "alpine_skiing", labelKey: "alpine_skiing" },
    { value: "backcountry_skiing", labelKey: "backcountry_skiing" },
    { value: "snowboarding", labelKey: "snowboarding" },
    { value: "snowshoeing", labelKey: "snowshoeing" },
    { value: "soccer", labelKey: "soccer" },
    { value: "tennis", labelKey: "tennis" },
    { value: "golf", labelKey: "golf" },
    { value: "wheelchair", labelKey: "wheelchair" },
  ],
};

// ── Race types ────────────────────────────────────────────────────────
//
// `labelKey` values map to `labels.raceTypes.<labelKey>` in the message files.

export const RACE_TYPES = [
  { value: "road_run", labelKey: "road_run" },
  { value: "trail_run", labelKey: "trail_run" },
  { value: "marathon", labelKey: "marathon" },
  { value: "ultra", labelKey: "ultra" },
  { value: "triathlon", labelKey: "triathlon" },
  { value: "cycling", labelKey: "cycling" },
  { value: "other", labelKey: "other" },
] as const;

// ── Source display labels ─────────────────────────────────────────────
//
// Values map to `labels.sources.<value>` in the message files. Render with
// `t("labels.sources." + SOURCE_LABELS[source])`.

export const SOURCE_LABELS: Record<string, string> = {
  strava: "strava",
  garmin: "garmin",
  watch_push: "watchPush",
  manual: "manual",
};

// ── Source badge colours ──────────────────────────────────────────────

export const SOURCE_COLORS: Record<string, "default" | "success" | "warning" | "secondary"> = {
  strava: "default",
  garmin: "success",
  watch_push: "warning",
  manual: "secondary",
};

// ── Activity type labels (for filter buttons, etc.) ───────────────────
//
// Values map to `labels.activityTypes.<value>` in the message files.

export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  run: "run",
  ride: "ride",
  swim: "swim",
  hike: "hike",
  workout: "workout",
  walk: "walk",
  other: "other",
};

// ── Day names ─────────────────────────────────────────────────────────

export const SHORT_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const LONG_DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
