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

/**
 * Format a Date as "YYYY-MM-DD" using LOCAL timezone components.
 *
 * Use this INSTEAD of `toISOString().split("T")[0]` when the source
 * date was computed using local-timezone methods (e.g. `new Date(year, month, day)`).
 * `toISOString()` always serializes in UTC, which shifts the date backward
 * for positive UTC offsets — e.g. July 1 midnight in UTC+8 becomes June 30 in UTC.
 *
 * For UTC-accurate DB timestamps, use `toISOString().split("T")[0]` or `utcDateStr()`.
 */
export function localDateStr(d: Date, tzOffset?: number): string {
  if (tzOffset != null) {
    // Convert the UTC instant to the user's local time using the offset the
    // browser reported via Date.getTimezoneOffset() (negative for UTC+).
    // Reading UTC components of the shifted instant keeps this independent
    // of the server's own timezone (which may be UTC in production).
    const shifted = new Date(d.getTime() - tzOffset * 60000);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
    const day = String(shifted.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Day of week (0=Sun..6=Sat) of a UTC instant in the user's local timezone.
 * Mirrors `localDateStr(d, tzOffset)`'s shifting so the two always agree.
 */
export function localDayOfWeek(date: Date, tzOffset: number): number {
  const shifted = new Date(date.getTime() - tzOffset * 60000);
  return shifted.getUTCDay();
}

/**
 * Monday of the week containing the user's local date, as "YYYY-MM-DD".
 * Unlike `getWeekStart()` (which aligns to UTC weeks), this aligns to the
 * user's own Mon–Sun week boundaries.
 */
export function localWeekStart(date: Date, tzOffset: number): string {
  const dateStr = localDateStr(date, tzOffset);
  const dow = localDayOfWeek(date, tzOffset);
  const [y, m, d] = dateStr.split("-").map(Number);
  const jsDate = new Date(Date.UTC(y, m - 1, d));
  const diff = dow === 0 ? -6 : 1 - dow;
  jsDate.setUTCDate(jsDate.getUTCDate() + diff);
  const my = String(jsDate.getUTCMonth() + 1).padStart(2, "0");
  const md = String(jsDate.getUTCDate()).padStart(2, "0");
  return `${jsDate.getUTCFullYear()}-${my}-${md}`;
}

/**
 * Format a Date as a UTC ISO string. Alias for `d.toISOString()` with
 * explicit intent — use this when you want the UTC date serialization.
 */
export function utcDateStr(d: Date): string {
  return d.toISOString();
}

/**
 * Parse a client-sent date string "YYYY-MM-DD" into a Date, adjusted by
 * the client's UTC offset so the server query matches the user's local
 * day boundaries.
 *
 * ## Why this is needed
 *
 * The browser computes date ranges in the user's local timezone (e.g.
 * "this week is Jul 27 – Aug 2" in MYT). Without adjustment, the server
 * interprets "2026-07-27" as midnight UTC, which maps to 8am MYT for
 * UTC+8 users — excluding morning activities from the query.
 *
 * This function treats the input as a local-midnight time and shifts it
 * to the equivalent UTC instant using the client's offset.
 *
 * @param dateStr - "YYYY-MM-DD" from client (local date)
 * @param tzOffset - Client's timezone offset in MINUTES as reported by
 *                   `Date.getTimezoneOffset()` (negative for UTC+).
 *                   Default 0 means the date is interpreted as UTC midnight.
 */
export function parseClientDate(dateStr: string, tzOffset: number = 0): Date {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCMinutes(d.getUTCMinutes() + tzOffset);
  return d;
}

/**
 * Return the Monday of the week containing `date`, at 00:00:00 UTC.
 *
 * Uses UTC methods explicitly so the result is correct regardless of
 * the server's timezone setting. DB timestamps are UTC, so UTC-based
 * week alignment is consistent with stored data.
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  // Sunday = 0: subtract 6 days → Monday. Mon–Sat: subtract (day-1) days.
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Return the Sunday of the week containing `date`, at 23:59:59.999 UTC.
 */
export function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
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

/**
 * Return the first day of the month containing `date`, at 00:00:00 UTC.
 */
export function getMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Return the last day of the month containing `date`, at 23:59:59.999 UTC.
 */
export function getMonthEnd(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

// ── Geometry ────────────────────────────────────────────

/** Convert degrees to radians. */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine distance between two GPS coordinates in meters.
 * Uses the WGS-84 ellipsoid approximation (Earth radius ≈ 6,371 km).
 */
export function haversine(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const a =
    sinLat * sinLat +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
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
