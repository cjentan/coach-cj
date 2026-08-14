import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Units = "metric" | "imperial";

type UnitLabels = {
  km: string;
  m: string;
  mi: string;
  ft: string;
  yd: string;
  h: string;
  min: string;
  sec: string;
  speed: string;
  perDistance: string;
  per100: string;
};

const METRIC_LABELS: Record<string, UnitLabels> = {
  en: { km: "km", m: "m", mi: "mi", ft: "ft", yd: "yd", h: "h", min: "m", sec: "s", speed: "km/h", perDistance: "/km", per100: "/100m" },
  "zh-CN": { km: "公里", m: "米", mi: "英里", ft: "英尺", yd: "码", h: "小时", min: "分", sec: "秒", speed: "公里/小时", perDistance: "/公里", per100: "/100米" },
  "zh-TW": { km: "公里", m: "公尺", mi: "英里", ft: "英尺", yd: "碼", h: "小時", min: "分", sec: "秒", speed: "公里/小時", perDistance: "/公里", per100: "/100公尺" },
};

const IMPERIAL_LABELS: Record<string, UnitLabels> = {
  en: { km: "mi", m: "ft", mi: "mi", ft: "ft", yd: "yd", h: "h", min: "m", sec: "s", speed: "mph", perDistance: "/mi", per100: "/100yd" },
  "zh-CN": { km: "英里", m: "英尺", mi: "英里", ft: "英尺", yd: "码", h: "小时", min: "分", sec: "秒", speed: "英里/小时", perDistance: "/英里", per100: "/100码" },
  "zh-TW": { km: "英里", m: "英尺", mi: "英里", ft: "英尺", yd: "碼", h: "小時", min: "分", sec: "秒", speed: "英里/小時", perDistance: "/英里", per100: "/100碼" },
};

// Module-level default so the format* helpers reflect the active setting
// without every call site threading a `units` argument. The UnitsProvider
// calls setDefaultUnits() when the user toggles the setting.
let defaultUnits: Units = "metric";
export function setDefaultUnits(units: Units) {
  defaultUnits = units;
}
export function getCurrentUnits(): Units {
  return defaultUnits;
}

function getUnits(locale = "en", units: Units = defaultUnits): UnitLabels {
  const map = units === "imperial" ? IMPERIAL_LABELS : METRIC_LABELS;
  return map[locale] || map.en;
}

export function formatDistance(meters: number, type?: string, locale = "en", units: Units = defaultUnits): string {
  const labels = getUnits(locale, units);
  // Swims: always show in meters (metric) or yards (imperial) — pool distances
  // are typically well under a mile, so miles would be awkward.
  if (type === "swim") {
    if (units === "imperial") {
      return `${Math.round(meters * 1.09361)} ${labels.yd}`;
    }
    return `${Math.round(meters)} ${labels.m}`;
  }
  if (units === "imperial") {
    if (meters >= 1609.344) {
      return `${(meters / 1609.344).toFixed(1)} ${labels.mi}`;
    }
    if (meters >= 402.336) {
      return `${(meters / 1609.344).toFixed(2)} ${labels.mi}`;
    }
    return `${Math.round(meters * 3.28084)} ${labels.ft}`;
  }
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} ${labels.km}`;
  }
  return `${Math.round(meters)} ${labels.m}`;
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

export function formatPace(metersPerSecond: number, type?: string, locale = "en", units: Units = defaultUnits): string {
  const labels = getUnits(locale, units);
  if (metersPerSecond === 0) return "--:--";
  // Rides: show speed
  if (type === "ride") {
    const speed = units === "imperial" ? metersPerSecond * 2.23694 : metersPerSecond * 3.6;
    return `${speed.toFixed(1)} ${labels.speed}`;
  }
  // Swims: pace as min/100m (metric) or min/100yd (imperial)
  if (type === "swim") {
    const distance = units === "imperial" ? 91.44 : 100;
    const minPer = distance / metersPerSecond / 60;
    const minutes = Math.floor(minPer);
    const seconds = Math.round((minPer - minutes) * 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")} ${labels.per100}`;
  }
  // Runs & others: pace as min/km (metric) or min/mi (imperial)
  const distance = units === "imperial" ? 1609.344 : 1000;
  const minPer = distance / metersPerSecond / 60;
  const minutes = Math.floor(minPer);
  const seconds = Math.round((minPer - minutes) * 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")} ${labels.perDistance}`;
}

// ── Body-metric conversions ──────────────────────────────

export function kgToLb(kg: number): number {
  return kg * 2.2046226218;
}
export function lbToKg(lb: number): number {
  return lb / 2.2046226218;
}
export function cmToIn(cm: number): number {
  return cm / 2.54;
}
export function inToCm(inches: number): number {
  return inches * 2.54;
}

/** Format a weight (kg) for display, honoring the active units. */
export function formatWeight(kg: number | null | undefined, units: Units = defaultUnits): string {
  if (kg == null || kg <= 0) return "";
  if (units === "imperial") return `${kgToLb(kg).toFixed(1)} lb`;
  return `${kg.toFixed(1)} kg`;
}

/** Format a height (cm) for display, honoring the active units. */
export function formatHeight(cm: number | null | undefined, units: Units = defaultUnits): string {
  if (cm == null || cm <= 0) return "";
  if (units === "imperial") {
    const totalIn = cmToIn(cm);
    const ft = Math.floor(totalIn / 12);
    let inches = Math.round(totalIn % 12);
    if (inches === 12) {
      return `${ft + 1}'0"`;
    }
    return `${ft}'${inches}"`;
  }
  return `${Math.round(cm)} cm`;
}

// ── Goal / race input unit conversions ──────────────────────
// Race-goal forms store meters server-side, but let the user enter distance
// in m/km/mi and elevation in m/ft. These convert between the two.

export type DistanceUnit = "m" | "km" | "mi";
export type ElevationUnit = "m" | "ft";

/** Default input unit for a new goal, matching the app-wide Units setting. */
export function defaultDistanceUnit(units: Units): DistanceUnit {
  return units === "imperial" ? "mi" : "km";
}

/** Default input unit for elevation, matching the app-wide Units setting. */
export function defaultElevationUnit(units: Units): ElevationUnit {
  return units === "imperial" ? "ft" : "m";
}

/** Convert a distance entered in any supported unit to meters. */
export function distanceToMeters(value: number, unit: DistanceUnit): number {
  if (unit === "km") return value * 1000;
  if (unit === "mi") return value * 1609.344;
  return value;
}

/** Convert meters to a distance in the given unit. */
export function metersToDistance(meters: number, unit: DistanceUnit): number {
  if (unit === "km") return meters / 1000;
  if (unit === "mi") return meters / 1609.344;
  return meters;
}

/** Convert an elevation entered in meters or feet to meters. */
export function elevationToMeters(value: number, unit: ElevationUnit): number {
  return unit === "ft" ? value / 3.28084 : value;
}

/** Convert meters to an elevation in the given unit. */
export function metersToElevation(meters: number, unit: ElevationUnit): number {
  return unit === "ft" ? meters * 3.28084 : meters;
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
 * Metric shows e.g. "450m" under 1000m and "1.2km" above; imperial always
 * shows feet.
 */
export function formatElevation(meters: number | null | undefined, units: Units = defaultUnits): string {
  if (!meters || meters <= 0) return "";
  if (units === "imperial") {
    return `${Math.round(meters * 3.28084)}ft`;
  }
  // Elevation is always expressed in meters (or feet), never scaled to km/mi.
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
