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
import { computePowerTss, computeHrTssEstimate, estimateTss } from "@/lib/training-math";
import { mapFitSport } from "./sport-mappings";

// fit-file-parser has no TypeScript types, so we use require-style import
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

// Mapping tables moved to shared module: src/lib/sport-mappings.ts
// Use mapFitSport() instead of SPORT_MAP/SUB_SPORT_MAP directly.

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
        let records = data?.records || data?.activity?.records || [];

        // Extract the Garmin device-local timestamp (reflects the watch's timezone).
        // When available, use it for time-of-day naming instead of UTC start_time.
        const localTimestamp: Date | undefined = data?.activity?.local_timestamp
          ? new Date(data.activity.local_timestamp as string)
          : undefined;

        for (const session of sessions) {
          const { type: sportType, subType: mappedSubType } = mapFitSport(
            session.sport,
            session.sub_sport
          );
          const subType = mappedSubType ?? null;
          const startTime = session.start_time ? new Date(session.start_time) : new Date();

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
          let tss: number | null = null;

          // Running power data is notoriously unreliable (estimated power, variable terrain).
          // Skip the power formula for running/trail — use HR-based estimate instead.
          const isRunningSport = sportType === "run";
          if (!isRunningSport && normalizedPower && avgPower && avgPower > 0) {
            tss = computePowerTss(duration, normalizedPower, avgPower);
          } else if (avgHr && maxHr && maxHr > 0) {
            tss = computeHrTssEstimate(duration, avgHr, maxHr);
          } else {
            tss = estimateTss(duration);
          }

          // Cap per-activity TSS to prevent absurd values from ultra-long efforts
          // that would inflate CTL/ATL and break coach analysis
          if (tss !== null) {
            tss = Math.min(tss, 500);
          }

          const sportName = (session.sport || "Activity")
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());

          // Convert FIT records to TrackPoints (filter to those within this session's
          // time range) in a single pass — avoids materializing an intermediate
          // filtered copy, which matters for long activities with many records.
          const st = startTime.getTime();
          const et = st + duration * 1000;
          const trackPoints: TrackPoint[] = [];
          for (let i = 0; i < records.length; i++) {
            const r = records[i];
            if (r.timestamp) {
              const rt = new Date(r.timestamp).getTime();
              if (rt < st - 60000 || rt > et + 60000) continue; // 1min tolerance
            }
            trackPoints.push({
              lat: r.position_lat != null ? r.position_lat : null,
              lon: r.position_long != null ? r.position_long : null,
              ele: r.altitude ?? r.enhanced_altitude ?? null,
              time: r.timestamp ? new Date(r.timestamp).toISOString() : null,
              hr: r.heart_rate || null,
              cadence: r.cadence || null,
              power: r.power || null,
              distance: r.distance || null,
              speed: r.speed || null,
            });
          }

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

        // Free the large parsed record arrays now that the TrackPoints are copied
        // into `activities` — the source records can be tens of thousands of
        // objects. Releasing them here (before the caller persists/analyzes)
        // keeps peak memory bounded for long activities.
        records = [];
        (data as any).records = [];
        if (data?.activity) (data as any).activity.records = [];

        resolve(activities);
      } catch (err) {
        reject(new Error(`FIT processing error: ${(err as Error).message}`));
      }
    });
  });
}

function computeFromFitRecords(
  records: FitRecord[],
  localTimestamp?: Date
): ParsedFileActivity | null {
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

  const avgHr =
    hrValues.length > 0
      ? Math.round((hrValues.reduce((a, b) => a + b, 0) / hrValues.length) * 10) / 10
      : null;

  const maxHr = hrValues.length > 0 ? Math.max(...hrValues) : null;

  const avgCadence =
    cadenceValues.length > 0
      ? Math.round(cadenceValues.reduce((a, b) => a + b, 0) / cadenceValues.length)
      : null;

  const maxCadence = cadenceValues.length > 0 ? Math.max(...cadenceValues) : null;

  const avgPower =
    powerValues.length > 0
      ? Math.round(powerValues.reduce((a, b) => a + b, 0) / powerValues.length)
      : null;

  const tss = estimateTss(duration);

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
