/**
 * Shared activity type/subtype mapping utilities.
 *
 * Consolidates mapping logic that was previously duplicated across:
 *  - src/lib/csv-parser.ts  (Strava CSV strings)
 *  - src/lib/fit-parser.ts  (FIT sport/sub_sport codes)
 *  - src/lib/gpx-parser.ts  (name-based heuristics)
 */
import { ActivityType, ActivitySubType } from "@prisma/client";

// ─── Strava CSV sport string mapping ──────────────────────────────

/** Strava CSV sport string → ActivityType */
export const STRAVA_TYPE_MAP: Record<string, ActivityType> = {
  Run: "run",
  TrailRun: "run",
  "Trail Run": "run",
  VirtualRun: "run",
  "Virtual Run": "run",
  Ride: "ride",
  VirtualRide: "ride",
  "Virtual Ride": "ride",
  Swim: "swim",
  Hike: "hike",
  Walk: "walk",
  Workout: "workout",
  WeightTraining: "workout",
  "Weight Training": "workout",
  Yoga: "workout",
  Other: "other",
  "Rock Climbing": "other",
  Surfing: "other",
  "Stand Up Paddling": "other",
  Kayaking: "other",
  Canoeing: "other",
  Rowing: "other",
  Crossfit: "workout",
  Elliptical: "workout",
  StairStepper: "workout",
  "Ice Skating": "other",
  "Inline Skating": "other",
  "Nordic Ski": "other",
  "Alpine Ski": "other",
  "Backcountry Ski": "other",
  Snowboard: "other",
  Snowshoe: "other",
  Soccer: "other",
  Tennis: "other",
  Golf: "other",
  Wheelchair: "other",
  Handcycle: "ride",
};

/** Strava CSV sport string → ActivitySubType (undefined when none applies) */
export const STRAVA_SUB_TYPE_MAP: Record<string, ActivitySubType | undefined> = {
  Run: undefined,
  TrailRun: "trail_running",
  "Trail Run": "trail_running",
  VirtualRun: "virtual_run",
  "Virtual Run": "virtual_run",
  Ride: undefined,
  VirtualRide: "virtual_ride",
  "Virtual Ride": "virtual_ride",
  Swim: undefined,
  Hike: undefined,
  Walk: undefined,
  Workout: undefined,
  WeightTraining: "strength_training",
  "Weight Training": "strength_training",
  Yoga: "yoga",
  Crossfit: "crossfit",
  Elliptical: "elliptical",
  StairStepper: "stair_stepper",
  "Rock Climbing": "rock_climbing",
  Surfing: "surfing",
  "Stand Up Paddling": "stand_up_paddling",
  Kayaking: "kayaking",
  Canoeing: "canoeing",
  Rowing: "rowing",
  "Ice Skating": "ice_skating",
  "Inline Skating": "inline_skating",
  "Nordic Ski": "nordic_skiing",
  "Alpine Ski": "alpine_skiing",
  "Backcountry Ski": "backcountry_skiing",
  Snowboard: "snowboarding",
  Snowshoe: "snowshoeing",
  Soccer: "soccer",
  Tennis: "tennis",
  Golf: "golf",
  Wheelchair: "wheelchair",
  Handcycle: "handcycle",
  Other: undefined,
};

/**
 * Map a Strava CSV sport string to Prisma (type, subType).
 *
 * @example mapStravaSport("TrailRun")         => { type: "run", subType: "trail_running" }
 * @example mapStravaSport("Run")              => { type: "run", subType: undefined }
 * @example mapStravaSport("UnknownSport")     => { type: "other", subType: undefined }
 */
export function mapStravaSport(sport: string): { type: ActivityType; subType?: ActivitySubType } {
  const type = STRAVA_TYPE_MAP[sport] || "other";
  const subType = STRAVA_SUB_TYPE_MAP[sport];
  return { type, subType };
}

// ─── FIT sport/sub_sport mapping ──────────────────────────────────

/** FIT sport code → ActivityType */
export const FIT_SPORT_MAP: Record<string, ActivityType> = {
  running: "run",
  trail_running: "run",
  cycling: "ride",
  mountain_biking: "ride",
  swimming: "swim",
  hiking: "hike",
  walking: "walk",
  training: "workout",
  strength_training: "workout",
  generic: "other",
  all: "other",
};

/** FIT sub_sport code → ActivitySubType (undefined when none applies) */
export const FIT_SUB_SPORT_MAP: Record<string, ActivitySubType | undefined> = {
  running: undefined,
  trail: "trail_running",
  trail_running: "trail_running",
  cycling: undefined,
  mountain_biking: "mountain_biking",
  gravel_cycling: "gravel_cycling",
  road_cycling: "road_cycling",
  indoor_cycling: "indoor_cycling",
  swimming: undefined,
  hiking: undefined,
  walking: undefined,
  training: undefined,
  strength_training: "strength_training",
  yoga: "yoga",
  elliptical: "elliptical",
  stair_stepper: "stair_stepper",
  pilates: "pilates",
  crossfit: "crossfit",
  rowing: "rowing",
  rock_climbing: "rock_climbing",
  surfing: "surfing",
  stand_up_paddling: "stand_up_paddling",
  kayaking: "kayaking",
  canoeing: "canoeing",
  ice_skating: "ice_skating",
  inline_skating: "inline_skating",
  nordic_skiing: "nordic_skiing",
  alpine_skiing: "alpine_skiing",
  backcountry_skiing: "backcountry_skiing",
  snowboarding: "snowboarding",
  snowshoeing: "snowshoeing",
  soccer: "soccer",
  tennis: "tennis",
  golf: "golf",
  wheelchair: "wheelchair",
  generic: undefined,
  all: undefined,
};

/**
 * Map FIT sport/sub_sport codes to Prisma (type, subType).
 *
 * Uses the sport as the primary determinant; falls back to sub_sport
 * only when the sport is not recognised (e.g. sport="generic", sub_sport="walking").
 * This prevents sub_sport="generic" from overriding a valid sport like "cycling".
 *
 * @example mapFitSport("running", "trail")    => { type: "run", subType: "trail_running" }
 * @example mapFitSport("cycling")             => { type: "ride", subType: undefined }
 * @example mapFitSport("generic", "walking")  => { type: "walk", subType: undefined }
 */
export function mapFitSport(
  sport?: string,
  subSport?: string
): { type: ActivityType; subType?: ActivitySubType } {
  const sportKey = (sport || "").toLowerCase();
  const subKey = (subSport || "").toLowerCase();

  const type = FIT_SPORT_MAP[sportKey] || FIT_SPORT_MAP[subKey] || "other";
  const subType = FIT_SUB_SPORT_MAP[subKey];

  return { type, subType };
}

// ─── Name-based inference (for GPX/TCX files without metadata) ───

/**
 * Infer (type, subType) from an activity name string.
 *
 * Uses keyword heuristics on the name to detect the activity type and subtype.
 * This is used for GPX/TCX files that do not carry structured sport metadata.
 *
 * @example inferFromName("Morning Trail Run")       => { type: "run", subType: "trail_running" }
 * @example inferFromName("Afternoon Ride")           => { type: "ride", subType: undefined }
 * @example inferFromName("Morning Swim at the Pool") => { type: "swim", subType: "lap_swimming" }
 */
export function inferFromName(name: string): { type: ActivityType; subType?: ActivitySubType } {
  const lower = name.toLowerCase();

  // ── Type ────────────────────────────────────────────────────
  let type: ActivityType;
  if (lower.includes("ride") || lower.includes("bike") || lower.includes("cycling")) {
    type = "ride";
  } else if (lower.includes("swim")) {
    type = "swim";
  } else if (lower.includes("hike")) {
    type = "hike";
  } else if (lower.includes("walk")) {
    type = "walk";
  } else if (lower.includes("workout") || lower.includes("strength") || lower.includes("gym")) {
    type = "workout";
  } else {
    type = "run"; // default fallback activity type
  }

  // ── Sub-type ────────────────────────────────────────────────
  let subType: ActivitySubType | undefined;

  if (lower.includes("trail")) {
    subType = "trail_running";
  } else if (lower.includes("treadmill")) {
    subType = "treadmill";
  } else if (lower.includes("track")) {
    subType = "trail_running";
  } else if (lower.includes("virtual") && (lower.includes("run") || lower.includes("race"))) {
    subType = "virtual_run";
  } else if (lower.includes("mountain") || lower.includes("mtb")) {
    subType = "mountain_biking";
  } else if (lower.includes("gravel")) {
    subType = "gravel_cycling";
  } else if (lower.includes("road")) {
    subType = "road_cycling";
  } else if (lower.includes("indoor") || lower.includes("trainer")) {
    subType = "indoor_cycling";
  } else if (lower.includes("virtual") && lower.includes("ride")) {
    subType = "virtual_ride";
  } else if (lower.includes("open water")) {
    subType = "open_water";
  } else if (lower.includes("pool") || lower.includes("lap")) {
    subType = "lap_swimming";
  } else if (lower.includes("strength") || lower.includes("weight") || lower.includes("gym")) {
    subType = "strength_training";
  } else if (lower.includes("yoga")) {
    subType = "yoga";
  } else if (lower.includes("crossfit")) {
    subType = "crossfit";
  } else if (lower.includes("elliptical")) {
    subType = "elliptical";
  } else if (lower.includes("stair")) {
    subType = "stair_stepper";
  } else if (lower.includes("pilates")) {
    subType = "pilates";
  } else if (lower.includes("row")) {
    subType = "rowing";
  } else if (lower.includes("rock climb")) {
    subType = "rock_climbing";
  } else if (lower.includes("surf")) {
    subType = "surfing";
  } else if (lower.includes("kayak")) {
    subType = "kayaking";
  } else if (lower.includes("canoe")) {
    subType = "canoeing";
  }

  return { type, subType };
}
