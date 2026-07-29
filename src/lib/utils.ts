import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type UnitLabels = {
  km: string;
  m: string;
  h: string;
  min: string;
  sec: string;
  kmh: string;
  perKm: string;
  per100m: string;
};

const UNIT_MAP: Record<string, UnitLabels> = {
  en: { km: "km", m: "m", h: "h", min: "m", sec: "s", kmh: "km/h", perKm: "/km", per100m: "/100m" },
  "zh-CN": { km: "公里", m: "米", h: "小时", min: "分", sec: "秒", kmh: "公里/小时", perKm: "/公里", per100m: "/100米" },
  "zh-TW": { km: "公里", m: "公尺", h: "小時", min: "分", sec: "秒", kmh: "公里/小時", perKm: "/公里", per100m: "/100公尺" },
};

function getUnits(locale = "en"): UnitLabels {
  return UNIT_MAP[locale] || UNIT_MAP.en;
}

export function formatDistance(meters: number, type?: string, locale = "en"): string {
  const units = getUnits(locale);
  // Swims: always show in meters (pool distances are typically < 5km)
  if (type === "swim") {
    return `${Math.round(meters)} ${units.m}`;
  }
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} ${units.km}`;
  }
  return `${Math.round(meters)} ${units.m}`;
}

export function formatDuration(seconds: number, locale = "en"): string {
  const units = getUnits(locale);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) {
    return `${h}${units.h} ${m}${units.min}`;
  }
  return `${m}${units.min}`;
}

export function formatPace(metersPerSecond: number, type?: string, locale = "en"): string {
  const units = getUnits(locale);
  if (metersPerSecond === 0) return "--:--";
  // Rides: show speed in km/h
  if (type === "ride") {
    return `${(metersPerSecond * 3.6).toFixed(1)} ${units.kmh}`;
  }
  // Swims: pace as min/100m
  if (type === "swim") {
    const minPer100m = 100 / metersPerSecond / 60;
    const minutes = Math.floor(minPer100m);
    const seconds = Math.round((minPer100m - minutes) * 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")} ${units.per100m}`;
  }
  // Runs & others: pace as min/km
  const minPerKm = 1000 / metersPerSecond / 60;
  const minutes = Math.floor(minPerKm);
  const seconds = Math.round((minPerKm - minutes) * 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")} ${units.perKm}`;
}

export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function getWeekLabel(date: Date, locale = "en"): string {
  const start = getWeekStart(date);
  const end = getWeekEnd(date);
  const localeStr = locale === "zh-CN" ? "zh-CN" : locale === "zh-TW" ? "zh-TW" : "en-US";
  const startStr = start.toLocaleDateString(localeStr, { month: "short", day: "numeric" });
  const endStr = end.toLocaleDateString(localeStr, { month: "short", day: "numeric" });
  return `${startStr} – ${endStr}`;
}

export function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

// ── Workout classification ───────────────────────────────

export type EffortLevel = "rest" | "easy" | "moderate" | "hard";
export type SurfaceType = "trail" | "road" | "track" | "indoor" | null;

/**
 * Infer effort level from a planned session's type and description.
 * Uses keyword matching on the free-text description with a fallback to
 * the session type enum.
 */
export function inferEffort(type: string, description?: string): EffortLevel {
  if (type === "rest") return "rest";
  const desc = (description ?? "").toLowerCase();

  // Hard efforts
  if (
    desc.includes("interval") ||
    desc.includes("vo2max") ||
    desc.includes("hill repeat") ||
    desc.includes("sprint") ||
    desc.includes("strides") ||
    desc.includes("all-out") ||
    desc.includes("race pace") ||
    desc.includes("anaerobic") ||
    desc.includes("hard effort")
  ) {
    return "hard";
  }

  // Moderate efforts
  if (
    desc.includes("tempo") ||
    desc.includes("threshold") ||
    desc.includes("lactate") ||
    desc.includes("long run") ||
    desc.includes("steady") ||
    desc.includes("marathon pace") ||
    desc.includes("moderate")
  ) {
    return "moderate";
  }

  // Easy / recovery
  if (
    desc.includes("easy") ||
    desc.includes("recovery") ||
    desc.includes("zone 2") ||
    desc.includes("z2") ||
    desc.includes("conversation") ||
    desc.includes("regeneration") ||
    desc.includes("shakeout") ||
    desc.includes("gentle")
  ) {
    return "easy";
  }

  // Fallback based on type
  if (type === "workout" || type === "hike") return "moderate";
  if (type === "ride" || type === "swim") return "moderate";
  if (type === "run") return "easy"; // default run is easy

  return "rest";
}

/**
 * Infer surface type from the session description.
 */
export function inferSurface(description?: string): SurfaceType {
  if (!description) return null;
  const desc = description.toLowerCase();

  if (desc.includes("trail")) return "trail";
  if (desc.includes("track")) return "track";
  if (desc.includes("treadmill") || desc.includes("indoor")) return "indoor";
  if (desc.includes("road")) return "road";
  if (desc.includes("path") || desc.includes("pavement")) return "road";

  return null;
}

/**
 * Format elevation gain in meters for display.
 * Shows as e.g. "450m" under 1000m, and "1.2km" above.
 */
export function formatElevation(meters: number | null | undefined): string {
  if (!meters || meters <= 0) return "";
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)}km`;
  }
  return `${Math.round(meters)}m`;
}

/**
 * Get the activity icon component name for a session type.
 * Returns lucide-react icon name strings.
 */
export function getActivityIcon(type: string): string {
  const map: Record<string, string> = {
    run: "Footprints",
    ride: "Bike",
    swim: "Waves",
    workout: "Dumbbell",
    hike: "Mountain",
    rest: "Moon",
    other: "Activity",
  };
  return map[type.toLowerCase()] ?? "Activity";
}
