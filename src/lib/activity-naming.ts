/**
 * Activity naming utilities — generates human-readable activity names from
 * ingestion data (GPS coordinates, start time, activity type).
 *
 * ## Naming format
 *
 *   <Area> <TimeOfDay> <ActivityType>
 *
 * e.g. "Sireh Park Afternoon Trail Run", "Eko Flora Morning Run"
 *
 * ## Caching strategy
 *
 * Since most activities repeat in the same areas, we use a two-tier local
 * cache to minimise external API calls:
 *
 *   1. In-memory Map<string, string>  — instant, session-scoped
 *   2. data/geocode-cache.json         — persistent across restarts
 *
 * Only when both miss do we call the Nominatim reverse-geocode API.
 * Cache keys are (lat.toFixed(3), lon.toFixed(3)) ≈ 111 m grid, so
 * nearby start points share the same cache entry.
 */
import { ActivityType, ActivitySubType } from "@prisma/client";
import { TrackPoint } from "./gpx-parser";
import fs from "fs";
import path from "path";

// ─── Cache paths ──────────────────────────────────────────────

const CACHE_FILE = path.join(process.cwd(), "data", "geocode-cache.json");

// ─── In-memory caches ─────────────────────────────────────────

/** In-memory geocode cache: "lat,lon" → area name */
const memCache = new Map<string, string>();

/** Whether the JSON cache has been loaded into memCache yet */
let jsonCacheLoaded = false;

/** Simple promise chain to serialise writes to the JSON cache file */
let writeQueue: Promise<void> = Promise.resolve();

// ─── Nominatim rate limiting ──────────────────────────────────

let lastNominatimRequest = 0;

// ─── Time of day ──────────────────────────────────────────────

export function getTimeOfDay(date: Date): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "Morning";
  if (h >= 12 && h < 17) return "Afternoon";
  if (h >= 17 && h < 21) return "Evening";
  return "Night";
}

// ─── Activity type labels ─────────────────────────────────────

export function getActivityTypeLabel(
  type: ActivityType,
  subType: ActivitySubType | null,
): string {
  switch (subType) {
    // Running
    case "trail_running":
      return "Trail Run";
    case "treadmill":
      return "Treadmill Run";
    case "virtual_run":
      return "Virtual Run";
    // Cycling
    case "mountain_biking":
      return "Mountain Bike";
    case "gravel_cycling":
      return "Gravel Ride";
    case "road_cycling":
      return "Road Ride";
    case "indoor_cycling":
      return "Indoor Ride";
    case "virtual_ride":
      return "Virtual Ride";
    case "handcycle":
      return "Handcycle";
    // Swimming
    case "open_water":
      return "Open Water Swim";
    case "lap_swimming":
      return "Pool Swim";
    // Workout
    case "strength_training":
      return "Strength";
    case "crossfit":
      return "CrossFit";
    case "yoga":
      return "Yoga";
    case "elliptical":
      return "Elliptical";
    case "stair_stepper":
      return "Stair Stepper";
    case "pilates":
      return "Pilates";
    // Other
    case "rock_climbing":
      return "Rock Climb";
    case "surfing":
      return "Surf";
    case "kayaking":
      return "Kayak";
    case "canoeing":
      return "Canoe";
    case "rowing":
      return "Row";
    case "stand_up_paddling":
      return "Stand Up Paddle";
    case "ice_skating":
      return "Ice Skate";
    case "inline_skating":
      return "Inline Skate";
    case "nordic_skiing":
      return "Nordic Ski";
    case "alpine_skiing":
      return "Alpine Ski";
    case "backcountry_skiing":
      return "Backcountry Ski";
    case "snowboarding":
      return "Snowboard";
    case "snowshoeing":
      return "Snowshoe";
    case "soccer":
      return "Soccer";
    case "tennis":
      return "Tennis";
    case "golf":
      return "Golf";
    case "wheelchair":
      return "Wheelchair";
  }

  // Fallback to the top-level type name
  switch (type) {
    case "run":
      return "Run";
    case "ride":
      return "Ride";
    case "swim":
      return "Swim";
    case "hike":
      return "Hike";
    case "walk":
      return "Walk";
    case "workout":
      return "Workout";
    case "other":
      return "Activity";
  }
}

// ─── Coordinate helpers ───────────────────────────────────────

/**
 * Return the first trackpoint that has both lat and lon, or null.
 */
export function getFirstTrackPoint(
  trackPoints?: TrackPoint[],
): { lat: number; lon: number } | null {
  if (!trackPoints) return null;
  for (const tp of trackPoints) {
    if (tp.lat != null && tp.lon != null) {
      return { lat: tp.lat, lon: tp.lon };
    }
  }
  return null;
}

// ─── Cache I/O ────────────────────────────────────────────────

/**
 * Load the JSON cache file into memCache (called once, lazily).
 */
function loadJsonCache(): void {
  if (jsonCacheLoaded) return;
  jsonCacheLoaded = true;

  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, "utf-8");
      const data = JSON.parse(raw);
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === "string") {
          memCache.set(key, value);
        }
      }
    }
  } catch (err) {
    console.warn("[activity-naming] Failed to load geocode cache:", err);
  }
}

/**
 * Persist a single cache entry to the JSON file.
 *
 * Uses an atomic write (write to .tmp then rename) and serialises
 * through a promise chain to prevent concurrent-write corruption.
 */
function persistCacheEntry(key: string, area: string): void {
  writeQueue = writeQueue.then(async () => {
    try {
      // Read current state
      let data: Record<string, string> = {};
      if (fs.existsSync(CACHE_FILE)) {
        try {
          const raw = fs.readFileSync(CACHE_FILE, "utf-8");
          data = JSON.parse(raw);
        } catch {
          data = {};
        }
      }

      // Merge new entry (always uses the latest area for a given key)
      data[key] = area;

      // Atomic write: write to .tmp then rename
      const tmp = CACHE_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
      fs.renameSync(tmp, CACHE_FILE);
    } catch (err) {
      console.warn("[activity-naming] Failed to persist geocode cache:", err);
    }
  });
}

// ─── Reverse geocoding ────────────────────────────────────────

function normalizeCoord(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

/**
 * Resolve an area name from GPS coordinates using the two-tier local
 * cache, falling back to the Nominatim API.
 *
 * Cache key is (lat.toFixed(3), lon.toFixed(3)) — ~111 m grid
 * precision so the same park or neighbourhood shares one entry.
 */
export async function resolveAreaName(
  lat: number,
  lon: number,
): Promise<string | null> {
  const key = normalizeCoord(lat, lon);

  // 1. In-memory cache
  loadJsonCache();
  const cached = memCache.get(key);
  if (cached !== undefined) return cached;

  // 2. Nominatim API (rate-limited to 1 req/sec)
  const now = Date.now();
  const wait = 1000 - (now - lastNominatimRequest);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastNominatimRequest = Date.now();

  let area: string | null = null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=16&addressdetails=1`,
      {
        headers: {
          "User-Agent": "CoachCJ/1.0 (activity-naming; https://coach.example.com)",
        },
      },
    );
    if (res.ok) {
      const data = await res.json();
      const addr = data?.address;
      area =
        addr?.neighbourhood ||
        addr?.suburb ||
        addr?.hamlet ||
        addr?.village ||
        addr?.town ||
        addr?.city ||
        addr?.county ||
        null;
    }
  } catch (err) {
    console.warn("[activity-naming] Nominatim request failed:", err);
  }

  // Store in both caches (null is stored so we don't retry failed lookups)
  memCache.set(key, area ?? "");
  persistCacheEntry(key, area ?? "");

  return area;
}

// ─── Name generation ──────────────────────────────────────────

/**
 * Generate a full activity name including the area from reverse geocoding.
 *
 * Returns "<Area> <TimeOfDay> <ActivityType>" when an area is resolved,
 * or "<TimeOfDay> <ActivityType>" when no GPS data / lookup fails.
 */
export async function generateActivityName(
  type: ActivityType,
  subType: ActivitySubType | null,
  startDate: Date,
  trackPoints?: TrackPoint[],
): Promise<string> {
  const tod = getTimeOfDay(startDate);
  const label = getActivityTypeLabel(type, subType);

  // Best-effort: resolve area from the first GPS point
  const coord = getFirstTrackPoint(trackPoints);
  if (coord) {
    const area = await resolveAreaName(coord.lat, coord.lon);
    if (area) return `${area} ${tod} ${label}`;
  }

  return `${tod} ${label}`;
}

/**
 * Synchronous name generation (no area lookup).
 *
 * Returns "<TimeOfDay> <ActivityType>".
 */
export function generateBaseName(
  type: ActivityType,
  subType: ActivitySubType | null,
  startDate: Date,
): string {
  const tod = getTimeOfDay(startDate);
  const label = getActivityTypeLabel(type, subType);
  return `${tod} ${label}`;
}
