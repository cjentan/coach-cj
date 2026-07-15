/**
 * FIT file parser — wraps the fit-file-parser library for activity extraction.
 *
 * FIT (Flexible and Interoperable Data Transfer) is Garmin's binary format
 * used by Garmin watches, Edge cycling computers, and many other devices.
 *
 * We extract session-level summaries (sport, duration, distance, elevation, HR)
 * and optionally per-record time-series for more granular analysis.
 */
import { ActivityType, ActivitySubType } from "@prisma/client";
import { ParsedFileActivity, TrackPoint } from "./gpx-parser";
import { generateBaseName } from "./activity-naming";

// fit-file-parser has no TypeScript types, so we use require-style import
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FitParser = require("fit-file-parser").default;

interface FitSession {
  sport?: string;
  sub_sport?: string;
  start_time?: string | Date;
  total_timer_time?: number;
  total_elapsed_time?: number;
  total_distance?: number;
  total_ascent?: number;
  total_descent?: number;
  avg_heart_rate?: number;
  max_heart_rate?: number;
  avg_power?: number;
  max_power?: number;
  normalized_power?: number;
  total_calories?: number;
  avg_cadence?: number;
  max_cadence?: number;
  avg_temperature?: number;
}

interface FitRecord {
  timestamp?: string | Date;
  distance?: number;
  altitude?: number;
  enhanced_altitude?: number;
  heart_rate?: number;
  speed?: number;
  power?: number;
  cadence?: number;
  temperature?: number;
  position_lat?: number;
  position_long?: number;
}

interface FitData {
  activity?: {
    sessions?: FitSession[];
    records?: FitRecord[];
    local_timestamp?: string | Date;
  };
  /** Some FIT parsers place records at the top level instead of under activity */
  records?: FitRecord[];
}

const SPORT_MAP: Record<string, ActivityType> = {
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

const SUB_SPORT_MAP: Record<string, ActivitySubType | null> = {
  running: null,
  trail: "trail_running",
  trail_running: "trail_running",
  cycling: null,
  mountain_biking: "mountain_biking",
  gravel_cycling: "gravel_cycling",
  road_cycling: "road_cycling",
  indoor_cycling: "indoor_cycling",
  swimming: null,
  hiking: null,
  walking: null,
  training: null,
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
  generic: null,
  all: null,
};

function mapFitSport(sport?: string, subSport?: string): ActivityType {
  const sportKey = (sport || "").toLowerCase();
  const subKey = (subSport || "").toLowerCase();
  // Use the sport as the primary determinant; fall back to sub_sport
  // only when the sport isn't recognized (e.g. sport="generic", sub_sport="walking").
  // This prevents sub_sport="generic" wiping out a valid sport like "cycling".
  return SPORT_MAP[sportKey] || SPORT_MAP[subKey] || "other";
}

function mapFitSubSport(subSport?: string): ActivitySubType | null {
  const subKey = (subSport || "").toLowerCase();
  return SUB_SPORT_MAP[subKey] ?? null;
}

export function parseFitFile(buffer: Buffer): Promise<ParsedFileActivity[]> {
  return new Promise((resolve, reject) => {
    const parser = new FitParser({
      force: true,
      speedUnit: "m/s",
      lengthUnit: "m",
      temperatureUnit: "celsius",
      elapsedRecordField: true,
      mode: "both",
    });

    parser.parse(buffer, (error: Error | null, data: FitData) => {
      if (error) {
        reject(new Error(`FIT parse error: ${error.message}`));
        return;
      }

      try {
        const activities: ParsedFileActivity[] = [];
        const sessions = data?.activity?.sessions || [];
        // Some FIT parsers (fit-file-parser v2+) store records at the top level
        const records = data?.records || data?.activity?.records || [];

        // Extract the Garmin device-local timestamp (reflects the watch's timezone).
        // When available, use it for time-of-day naming instead of UTC start_time.
        const localTimestamp: Date | undefined = data?.activity?.local_timestamp
          ? new Date(data.activity.local_timestamp as string)
          : undefined;

        for (const session of sessions) {
          const sportType = mapFitSport(session.sport, session.sub_sport);
          const subType = mapFitSubSport(session.sub_sport);
          const startTime = session.start_time
            ? new Date(session.start_time)
            : new Date();

          // FIT duration is in seconds
          const duration = session.total_timer_time || session.total_elapsed_time || 0;

          // FIT distance is in meters
          const distance = session.total_distance || null;

          // Elevation in meters
          const elevation = session.total_ascent || null;

          const avgHr = session.avg_heart_rate || null;
          const maxHr = session.max_heart_rate || null;
          const avgPower = session.avg_power || null;
          const maxPower = session.max_power || null;
          const normalizedPower = session.normalized_power || null;
          const avgCadence = session.avg_cadence || null;
          const maxCadence = session.max_cadence || null;
          const calories = session.total_calories || null;

          // TSS estimate
          const hours = duration / 3600;
          let tss: number | null = null;
          if (normalizedPower && avgPower && avgPower > 0) {
            const intensity = normalizedPower / avgPower;
            tss = Math.round((duration * normalizedPower * intensity) / (avgPower * 36));
          } else if (avgHr && maxHr && maxHr > 0) {
            const intensity = avgHr / maxHr;
            tss = Math.round((duration * intensity * intensity) / 36);
          } else {
            tss = Math.round(hours * 50);
          }

          const sportName = (session.sport || "Activity")
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());

          // Convert FIT records to TrackPoints (filter to those within this session's time range)
          const sessionRecords = records.filter((r) => {
            if (!r.timestamp || !startTime) return true;
            const rt = new Date(r.timestamp).getTime();
            const st = startTime.getTime();
            const et = st + duration * 1000;
            return rt >= st - 60000 && rt <= et + 60000; // 1min tolerance
          });

          const trackPoints: TrackPoint[] = sessionRecords.map((r) => ({
            lat: r.position_lat != null ? r.position_lat : null,
            lon: r.position_long != null ? r.position_long : null,
            ele: r.altitude ?? r.enhanced_altitude ?? null,
            time: r.timestamp ? new Date(r.timestamp).toISOString() : null,
            hr: r.heart_rate || null,
            cadence: r.cadence || null,
            power: r.power || null,
            distance: r.distance || null,
            speed: r.speed || null,
          }));

          activities.push({
            name: generateBaseName(sportType, subType, startTime, undefined, localTimestamp),
            type: sportType,
            subType,
            startDate: startTime,
            durationSeconds: Math.round(duration),
            distanceMeters: distance ? Math.round(distance) : null,
            elevationGainMeters: elevation ? Math.round(elevation) : null,
            averageHr: avgHr ? Math.round(avgHr * 10) / 10 : null,
            maxHr: maxHr || null,
            averagePower: avgPower ? Math.round(avgPower) : null,
            maxPower: maxPower || null,
            normalizedPower: normalizedPower ? Math.round(normalizedPower) : null,
            averageCadence: avgCadence ? Math.round(avgCadence) : null,
            maxCadence: maxCadence || null,
            calories,
            tss,
            description: `Imported from FIT file. Sport: ${session.sport || "unknown"}${session.sub_sport ? ` (${session.sub_sport})` : ""}`,
            trackPoints,
            localTimestamp,
            laps: [],
          });
        }

        // If no sessions found but we have records, create a single activity from records
        if (activities.length === 0) {
          const fallbackRecords = data?.records || data?.activity?.records || [];
          if (fallbackRecords.length >= 2) {
            const activity = computeFromFitRecords(fallbackRecords, localTimestamp);
            if (activity) activities.push(activity);
          }
        }

        resolve(activities);
      } catch (err) {
        reject(new Error(`FIT processing error: ${(err as Error).message}`));
      }
    });
  });
}

function computeFromFitRecords(records: FitRecord[], localTimestamp?: Date): ParsedFileActivity | null {
  if (records.length < 2) return null;

  const first = records[0];
  const last = records[records.length - 1];

  const startTime = first.timestamp ? new Date(first.timestamp) : new Date();
  const endTime = last.timestamp ? new Date(last.timestamp) : new Date();
  const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

  const distance = last.distance || null;

  let totalAscent = 0;
  const hrValues: number[] = [];
  const cadenceValues: number[] = [];
  const powerValues: number[] = [];

  const trackPoints: TrackPoint[] = records.map((r) => {
    if (r.heart_rate != null) hrValues.push(r.heart_rate);
    if (r.cadence != null) cadenceValues.push(r.cadence);
    if (r.power != null) powerValues.push(r.power);
    return {
      lat: r.position_lat != null ? r.position_lat : null,
      lon: r.position_long != null ? r.position_long : null,
      ele: r.altitude ?? r.enhanced_altitude ?? null,
      time: r.timestamp ? new Date(r.timestamp).toISOString() : null,
      hr: r.heart_rate || null,
      cadence: r.cadence || null,
      power: r.power || null,
      distance: r.distance || null,
      speed: r.speed || null,
    };
  });

  for (let i = 1; i < records.length; i++) {
    const prevAlt = records[i - 1].altitude;
    const currAlt = records[i].altitude;
    if (prevAlt != null && currAlt != null && currAlt > prevAlt) {
      totalAscent += currAlt - prevAlt;
    }
  }

  const avgHr = hrValues.length > 0
    ? Math.round((hrValues.reduce((a, b) => a + b, 0) / hrValues.length) * 10) / 10
    : null;

  const maxHr = hrValues.length > 0 ? Math.max(...hrValues) : null;

  const avgCadence = cadenceValues.length > 0
    ? Math.round(cadenceValues.reduce((a, b) => a + b, 0) / cadenceValues.length)
    : null;

  const maxCadence = cadenceValues.length > 0 ? Math.max(...cadenceValues) : null;

  const avgPower = powerValues.length > 0
    ? Math.round(powerValues.reduce((a, b) => a + b, 0) / powerValues.length)
    : null;

  const hours = duration / 3600;
  const tss = Math.round(hours * 50);

  return {
    name: generateBaseName("other", null, startTime, undefined, localTimestamp),
    type: "other",
    subType: null,
    startDate: startTime,
    durationSeconds: duration > 0 ? duration : 3600,
    distanceMeters: distance ? Math.round(distance) : null,
    elevationGainMeters: totalAscent > 0 ? Math.round(totalAscent) : null,
    averageHr: avgHr,
    maxHr,
    averagePower: avgPower,
    maxPower: null,
    normalizedPower: null,
    averageCadence: avgCadence,
    maxCadence,
    calories: null,
    tss,
    description: "Computed from record-level FIT data (no session summary available)",
    trackPoints,
    localTimestamp,
    laps: [],
  };
}
