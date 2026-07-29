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

export interface ActivityTypeOption {
  value: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export const ACTIVITY_TYPES: ActivityTypeOption[] = [
  { value: "run", label: "Run", icon: Activity },
  { value: "ride", label: "Ride", icon: Bike },
  { value: "swim", label: "Swim", icon: Waves },
  { value: "hike", label: "Hike", icon: Mountain },
  { value: "walk", label: "Walk", icon: Footprints },
  { value: "workout", label: "Workout", icon: Dumbbell },
  { value: "other", label: "Other", icon: Activity },
];

// ── Sub-type options ──────────────────────────────────────────────────

export const SUB_TYPE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  run: [
    { value: "trail_running", label: "Trail Running" },
    { value: "treadmill", label: "Treadmill" },
    { value: "virtual_run", label: "Virtual Run" },
  ],
  ride: [
    { value: "mountain_biking", label: "Mountain Biking" },
    { value: "gravel_cycling", label: "Gravel Cycling" },
    { value: "road_cycling", label: "Road Cycling" },
    { value: "indoor_cycling", label: "Indoor Cycling" },
    { value: "virtual_ride", label: "Virtual Ride" },
    { value: "handcycle", label: "Handcycle" },
  ],
  swim: [
    { value: "open_water", label: "Open Water" },
    { value: "lap_swimming", label: "Lap Swimming" },
  ],
  workout: [
    { value: "strength_training", label: "Strength Training" },
    { value: "crossfit", label: "CrossFit" },
    { value: "yoga", label: "Yoga" },
    { value: "elliptical", label: "Elliptical" },
    { value: "stair_stepper", label: "Stair Stepper" },
    { value: "pilates", label: "Pilates" },
  ],
  other: [
    { value: "rock_climbing", label: "Rock Climbing" },
    { value: "surfing", label: "Surfing" },
    { value: "stand_up_paddling", label: "Stand Up Paddling" },
    { value: "kayaking", label: "Kayaking" },
    { value: "canoeing", label: "Canoeing" },
    { value: "rowing", label: "Rowing" },
    { value: "ice_skating", label: "Ice Skating" },
    { value: "inline_skating", label: "Inline Skating" },
    { value: "nordic_skiing", label: "Nordic Skiing" },
    { value: "alpine_skiing", label: "Alpine Skiing" },
    { value: "backcountry_skiing", label: "Backcountry Skiing" },
    { value: "snowboarding", label: "Snowboarding" },
    { value: "snowshoeing", label: "Snowshoeing" },
    { value: "soccer", label: "Soccer" },
    { value: "tennis", label: "Tennis" },
    { value: "golf", label: "Golf" },
    { value: "wheelchair", label: "Wheelchair" },
  ],
};

// ── Race types ────────────────────────────────────────────────────────

export const RACE_TYPES = [
  { value: "road_run", label: "Road Run" },
  { value: "trail_run", label: "Trail Run" },
  { value: "marathon", label: "Marathon" },
  { value: "ultra", label: "Ultra" },
  { value: "triathlon", label: "Triathlon" },
  { value: "cycling", label: "Cycling" },
  { value: "other", label: "Other" },
] as const;

// ── Source display labels ─────────────────────────────────────────────

export const SOURCE_LABELS: Record<string, string> = {
  strava: "Strava",
  garmin: "Garmin",
  watch_push: "Watch Push",
  manual: "Manual",
};

// ── Source badge colours ──────────────────────────────────────────────

export const SOURCE_COLORS: Record<string, "default" | "success" | "warning" | "secondary"> = {
  strava: "default",
  garmin: "success",
  watch_push: "warning",
  manual: "secondary",
};

// ── Activity type labels (for filter buttons, etc.) ───────────────────

export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  run: "Run",
  ride: "Ride",
  swim: "Swim",
  hike: "Hike",
  workout: "Workout",
  walk: "Walk",
  other: "Other",
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
